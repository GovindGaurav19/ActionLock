import type { AppMode } from '@/types/actionlock';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface BackendUserDto {
  id: string;
  email: string;
  displayName: string;
  title?: string;
  department?: string;
  roles: string[];
  permissions?: string[];
  isDemo?: boolean;
}

export interface DemoAccountDto {
  id: string;
  email: string;
  displayName: string;
  title: string;
  department: string;
  roles: string[];
  isDemo: boolean;
}

export interface DashboardSummaryDto {
  generatedAt: string;
  envelopes: {
    total: number;
    activeCount: number;
    voiceRequiredCount: number;
    holdCount: number;
    stepUpCount: number;
    authorizedCount: number;
    rejectedCount: number;
    byState: Record<string, number>;
  };
  verifications: {
    completedCount: number;
    genuinePassCount: number;
    syntheticFlaggedCount: number;
    speakerMismatchCount: number;
    passRatePct: number | null;
  };
  interceptions: {
    totalBlocked: number;
    syntheticBlocked: number;
    hashDriftBlocked: number;
    openIncidents: number;
  };
  tokens: {
    mintedCount: number;
    consumedCount: number;
  };
  policies: {
    totalCount: number;
    activeCount: number;
  };
  webhooks: {
    totalCount: number;
    processedCount: number;
    pendingCount: number;
    failedCount: number;
    signatureValidCount: number;
    verifiedRatePct: number;
  };
  integrations: {
    detectifAiConfigured: boolean;
    sttConfigured: boolean;
    githubConfigured: boolean;
    webauthnRpId: string;
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string | { message?: string } };
    if (!res.ok) {
      const errMsg =
        typeof data?.error === 'string'
          ? data.error
          : data?.error?.message || `HTTP ${res.status} from ACTIONLOCK backend`;
      return { ok: false, status: res.status, error: errMsg, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Backend API unreachable',
    };
  }
}

export const actionLockApi = {
  getHealth: () =>
    requestJson<{
      status: string;
      detectifai: { configured: boolean; baseUrl: string; webhookSecretConfigured: boolean };
      githubAppConfigured: boolean;
      webauthnRpId: string;
    }>('/api/health'),

  getIntegrations: () =>
    requestJson<{
      mode: AppMode;
      detectifai: { status: string; configured: boolean; baseUrl: string };
      github: { status: string; configured: boolean };
      webauthn: { status: string; rpId: string };
    }>('/api/integrations'),

  listDemoAccounts: () => requestJson<{ accounts: DemoAccountDto[] }>('/api/auth/demo-accounts'),

  login: (email: string, password: string) =>
    requestJson<{ user: BackendUserDto; organisation: { id: string; name: string; region: string }; expiresAt: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
    ),

  logout: () => requestJson<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),

  getMe: () =>
    requestJson<{ user: BackendUserDto; organisation: { id: string; name: string; region: string }; sessionId: string }>(
      '/api/auth/me',
    ),

  getDashboardSummary: () => requestJson<DashboardSummaryDto>('/api/dashboard/summary'),

  listActions: () => requestJson<{ actions: Array<Record<string, unknown>> }>('/api/actions'),

  getAction: (actionId: string) => requestJson<{ action: Record<string, unknown> }>(`/api/actions/${encodeURIComponent(actionId)}`),

  createAction: (payload: Record<string, unknown>) =>
    requestJson<{ action: Record<string, unknown> }>('/api/actions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  mutateAction: (actionId: string, parameters: Record<string, unknown>, reason: string) =>
    requestJson<{ mutated: boolean; previousHash?: string; newHash?: string; action: Record<string, unknown> }>(
      `/api/actions/${encodeURIComponent(actionId)}/mutate`,
      {
        method: 'POST',
        body: JSON.stringify({ parameters, reason }),
      },
    ),

  verifyActionHash: (actionId: string, expectedActionHash?: string) =>
    requestJson<{ valid: boolean; reason: string; storedHash: string; recomputedHash: string }>(
      `/api/actions/${encodeURIComponent(actionId)}/verify-hash`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedActionHash }),
      },
    ),

  issueChallenge: (actionId: string) =>
    requestJson<{ challenge: { nonceId: string; issuedAt: string; expiresAt: string } }>(
      `/api/actions/${encodeURIComponent(actionId)}/challenge`,
      { method: 'POST' },
    ),

  submitRecording: (actionId: string, payload: { audioBase64: string; mimeType: string; speakerId: string; idempotencyKey: string }) =>
    requestJson<{ state: string; result?: unknown; error?: { code?: string; message?: string } }>(
      `/api/actions/${encodeURIComponent(actionId)}/recording`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  getPasskeyOptions: (actionId: string) =>
    requestJson<{ challenge: string; rpId: string; timeout: number; userVerification: string }>(
      `/api/actions/${encodeURIComponent(actionId)}/passkey/options`,
      { method: 'POST' },
    ),

  verifyPasskey: (actionId: string, assertion: Record<string, unknown>) =>
    requestJson<{ verified: boolean; state: string; error?: string }>(
      `/api/actions/${encodeURIComponent(actionId)}/passkey/verify`,
      { method: 'POST', body: JSON.stringify(assertion) },
    ),

  approveAction: (actionId: string) =>
    requestJson<{ state: string; error?: string }>(`/api/actions/${encodeURIComponent(actionId)}/approve`, {
      method: 'POST',
    }),

  rejectAction: (actionId: string, reason = 'Explicitly rejected') =>
    requestJson<{ state: string }>(`/api/actions/${encodeURIComponent(actionId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  listWebhooks: () => requestJson<{ events: unknown[] }>('/api/webhooks/events'),
  listAuditEvents: () => requestJson<{ events: unknown[] }>('/api/audit-events'),
  verifyAuditChain: () =>
    requestJson<{
      valid: boolean;
      totalCount: number;
      verifiedCount: number;
      brokenAtId: string | null;
      reason: string;
      headHash: string | null;
    }>('/api/audit-events/verify-chain'),
  listIncidents: () => requestJson<{ incidents: Array<Record<string, unknown>> }>('/api/incidents'),
  updateIncident: (incidentId: string, status: string, note = '') =>
    requestJson<{ incident: Record<string, unknown> }>(`/api/incidents/${encodeURIComponent(incidentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note }),
    }),
  listBreakGlassEvents: () => requestJson<{ events: Array<Record<string, unknown>> }>('/api/break-glass'),
  createBreakGlassEvent: (payload: {
    ticketId: string;
    justification: string;
    targetScope: string;
    custodians: string[];
    ttlMinutes: number;
    acknowledgedRunbook: boolean;
  }) =>
    requestJson<{ event: Record<string, unknown> }>('/api/break-glass', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listSpeakers: () => requestJson<{ speakers: Array<Record<string, unknown>> }>('/api/speakers'),
  enrollSpeaker: (payload: {
    userId?: string;
    audioBase64: string;
    mimeType: string;
    fileName?: string;
    durationSeconds?: number;
    consentAccepted: boolean;
    retentionAcknowledged: boolean;
    consentVersion?: string;
  }) =>
    requestJson<{ speaker: Record<string, unknown> }>('/api/speakers/enroll', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteSpeaker: (speakerId: string) =>
    requestJson<{ deleted: boolean; speakerId: string }>(`/api/speakers/${encodeURIComponent(speakerId)}`, {
      method: 'DELETE',
    }),

  getActionVerification: (actionId: string) =>
    requestJson<Record<string, unknown>>(`/api/actions/${encodeURIComponent(actionId)}/verification`),

  recoverOperation: (operationId: string) =>
    requestJson<Record<string, unknown>>(`/api/operations/${encodeURIComponent(operationId)}/recover`, {
      method: 'POST',
    }),

  listPolicies: () => requestJson<{ policies: Array<Record<string, unknown>> }>('/api/policies'),
  createPolicy: (payload: Record<string, unknown>) =>
    requestJson<{ policy: Record<string, unknown> }>('/api/policies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePolicy: (policyId: string, payload: Record<string, unknown>) =>
    requestJson<{ policy: Record<string, unknown> }>(`/api/policies/${encodeURIComponent(policyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getPasskeyRegOptions: () => requestJson<Record<string, unknown>>('/api/webauthn/register/options', { method: 'POST' }),
  verifyPasskeyReg: (response: unknown) =>
    requestJson<{ verified: boolean; credentialId: string }>('/api/webauthn/register/verify', {
      method: 'POST',
      body: JSON.stringify({ response }),
    }),
  peerApproveAction: (actionId: string, decision: 'APPROVED' | 'REJECTED', reason = '') =>
    requestJson<{ state: string; decision: string }>(`/api/actions/${encodeURIComponent(actionId)}/peer-approve`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    }),
  executeGitHubCallback: (
    actionId: string,
    payload: { decision: 'approved' | 'rejected'; permitToken?: string; comment?: string; installationId?: string },
  ) =>
    requestJson<{ ok: boolean; actionId: string; decision: string; githubStatus: number; callbackUrl: string }>(
      `/api/actions/${encodeURIComponent(actionId)}/github-callback`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
};
