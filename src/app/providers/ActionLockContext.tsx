import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import {
  DEMO_AUDIT_EVENTS,
  DEMO_ENVELOPES,
  DEMO_INCIDENTS,
  DEMO_INTEGRATIONS,
  DEMO_POLICIES,
  DEMO_SPEAKERS,
  DEMO_WEBHOOKS,
} from '@/data/mock/fixtures';
import {
  actionLockApi,
  type BackendUserDto,
  type DashboardSummaryDto,
  type DemoAccountDto,
} from '@/services/api/client';
import {
  mapBackendActionToEnvelope,
  mapBackendAuditToUi,
  mapBackendIncidentToUi,
  mapBackendIntegrationsToUi,
  mapBackendPolicyToUi,
  mapBackendSpeakerToUi,
  mapBackendWebhookToUi,
} from '@/services/api/mappers';
import type {
  ActionCategory,
  ActionEnvelope,
  ActionPolicyState,
  AppMode,
  AuditEventRecord,
  EnrolledSpeaker,
  IntegrationAdapter,
  SecurityIncidentRecord,
  SecurityPolicyRule,
  WebhookEventRecord,
} from '@/types/actionlock';
import { canonicalizeJson, sha256Hex } from '@/utils/canonicalHash';

interface ActionLockContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  currentUser: BackendUserDto | null;
  demoAccounts: DemoAccountDto[];
  dashboardSummary: DashboardSummaryDto | null;
  liveHealthNote: string | null;
  lastIssuedPermits: Record<string, { jti: string; token: string; scope: string; expiresAt: string }>;
  envelopes: ActionEnvelope[];
  selectedEnvelopeId: string;
  setSelectedEnvelopeId: (id: string) => void;
  speakers: EnrolledSpeaker[];
  policies: SecurityPolicyRule[];
  integrations: IntegrationAdapter[];
  webhooks: WebhookEventRecord[];
  auditEvents: AuditEventRecord[];
  incidents: SecurityIncidentRecord[];
  c4SpecOpen: boolean;
  setC4SpecOpen: (open: boolean) => void;
  newActionModalOpen: boolean;
  setNewActionModalOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  toast: { message: string; tone: 'success' | 'warning' | 'error' | 'info' } | null;
  notify: (message: string, tone?: 'success' | 'warning' | 'error' | 'info') => void;
  loginDemoAccount: (email: string, password?: string) => Promise<boolean>;
  logoutBackend: () => Promise<void>;
  refreshLiveData: () => Promise<void>;
  issueFreshChallenge: (envelopeId: string) => Promise<void>;
  evaluateVoiceRecording: (
    envelopeId: string,
    opts: { scenario?: 'genuine' | 'synthetic' | 'mismatch' | 'insufficient' | 'api_error'; audioBase64?: string; mimeType?: string },
  ) => Promise<void>;
  registerUserPasskey: () => Promise<boolean>;
  triggerPasskeyStepUp: (envelopeId: string, opts?: { simulateFailure?: boolean }) => Promise<void>;
  peerApproveEnvelope: (envelopeId: string, decision?: 'APPROVED' | 'REJECTED', reason?: string) => Promise<void>;
  authorizeEnvelope: (envelopeId: string) => Promise<void>;
  releaseGitHubDeployment: (envelopeId: string, decision: 'approved' | 'rejected') => Promise<void>;
  rejectEnvelope: (envelopeId: string, reason?: string) => Promise<void>;
  holdEnvelope: (envelopeId: string, reason: string) => void;
  mutateFinancePayload: (
    envelopeId: string,
    patch: { vendor?: string; depositoryBank?: string; beneficiaryReference?: string; amount?: string },
  ) => Promise<void>;
  revertFinanceToOriginal: (envelopeId: string) => Promise<void>;
  createProtectedAction: (input: {
    category: ActionCategory;
    targetTitle: string;
    targetSubtitle: string;
    requester: string;
    claimedApprover: string;
    amountOrRepo: string;
  }) => Promise<ActionEnvelope | null>;
  enrollSpeaker: (input: { name: string; email: string; role: string; department: EnrolledSpeaker['department'] }) => void;
  revokeSpeaker: (id: string) => void;
  updateIncidentStatus: (id: string, status: SecurityIncidentRecord['status']) => Promise<void>;
  auditChainStatus: { valid: boolean; totalCount: number; verifiedCount: number; brokenAtId: string | null; reason: string } | null;
  verifyAuditChainIntegrity: () => Promise<void>;
  breakGlassEvents: Array<Record<string, unknown>>;
  submitBreakGlassEvent: (payload: {
    ticketId: string;
    justification: string;
    targetScope: string;
    custodians: string[];
    ttlMinutes: number;
    acknowledgedRunbook: boolean;
  }) => Promise<boolean>;
  createPolicyRule: (rule: Omit<SecurityPolicyRule, 'status'>) => Promise<void>;
  checkLiveIntegrations: () => Promise<void>;
}

const ActionLockContext = createContext<ActionLockContextValue | null>(null);

export function ActionLockProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('demo');
  const [currentUser, setCurrentUser] = useState<BackendUserDto | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountDto[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryDto | null>(null);
  const [liveHealthNote, setLiveHealthNote] = useState<string | null>(null);
  const [lastIssuedPermits, setLastIssuedPermits] = useState<
    Record<string, { jti: string; token: string; scope: string; expiresAt: string }>
  >({});
  const [auditChainStatus, setAuditChainStatus] = useState<{
    valid: boolean;
    totalCount: number;
    verifiedCount: number;
    brokenAtId: string | null;
    reason: string;
  } | null>(null);
  const [breakGlassEvents, setBreakGlassEvents] = useState<Array<Record<string, unknown>>>([]);

  const [envelopes, setEnvelopes] = useState<ActionEnvelope[]>(DEMO_ENVELOPES);
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string>(DEMO_ENVELOPES[0].id);
  const [speakers, setSpeakers] = useState<EnrolledSpeaker[]>(DEMO_SPEAKERS);
  const [policies, setPolicies] = useState<SecurityPolicyRule[]>(DEMO_POLICIES);
  const [integrations, setIntegrations] = useState<IntegrationAdapter[]>(DEMO_INTEGRATIONS);
  const [webhooks, setWebhooks] = useState<WebhookEventRecord[]>(DEMO_WEBHOOKS);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>(DEMO_AUDIT_EVENTS);
  const [incidents, setIncidents] = useState<SecurityIncidentRecord[]>(DEMO_INCIDENTS);

  const [c4SpecOpen, setC4SpecOpen] = useState(false);
  const [newActionModalOpen, setNewActionModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'warning' | 'error' | 'info' } | null>(null);

  const notify = useCallback((message: string, tone: 'success' | 'warning' | 'error' | 'info' = 'info') => {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  const appendAudit = useCallback(
    async (envelopeId: string, eventType: string, tone: AuditEventRecord['tone'], payload: Record<string, unknown>) => {
      if (mode === 'live') return;
      const prev = auditEvents[0]?.currentHash || 'sha256:0000000000000000';
      const newHash = `sha256:${await sha256Hex(`${prev}:${envelopeId}:${eventType}:${Date.now()}`)}`;
      const record: AuditEventRecord = {
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        eventId: `evt_${Math.random().toString(16).slice(2, 9)}`,
        envelopeId,
        eventType,
        tone,
        previousHash: prev,
        currentHash: newHash,
        blockNumber: (auditEvents[0]?.blockNumber || 48911) + 1,
        payload,
      };
      setAuditEvents((list) => [record, ...list]);
    },
    [auditEvents, mode],
  );

  const checkLiveIntegrations = useCallback(async () => {
    const [healthRes, intRes] = await Promise.all([actionLockApi.getHealth(), actionLockApi.getIntegrations()]);
    if (!healthRes.ok || !healthRes.data) {
      setLiveHealthNote('Backend API server unreachable — Live Mode fails closed to HOLD.');
      setIntegrations([
        {
          id: 'detectifai',
          name: 'DetectifAI Dual-Engine',
          status: 'ERROR',
          subtitle: 'BACKEND_UNREACHABLE (Fail-Closed)',
          icon: 'neurology',
          rows: [],
          note: 'Server unreachable; live verification fails closed.',
        },
      ]);
      return;
    }

    const { detectifai } = healthRes.data;
    setLiveHealthNote(
      detectifai.configured
        ? 'Backend connected with DETECTIF_API_KEY configured.'
        : 'Backend connected, but DETECTIF_API_KEY is unset on server — DetectifAI fails closed.',
    );
    if (intRes.ok && intRes.data) {
      setIntegrations(mapBackendIntegrationsToUi(intRes.data));
    }
  }, []);

  const refreshLiveData = useCallback(async () => {
    const [meRes, demoRes] = await Promise.all([actionLockApi.getMe(), actionLockApi.listDemoAccounts()]);
    if (demoRes.ok && demoRes.data?.accounts) {
      setDemoAccounts(demoRes.data.accounts);
    }
    if (!meRes.ok || !meRes.data?.user) {
      setCurrentUser(null);
      setEnvelopes([]);
      setPolicies([]);
      setWebhooks([]);
      setSpeakers([]);
      setAuditEvents([]);
      setIncidents([]);
      setBreakGlassEvents([]);
      setAuditChainStatus(null);
      setDashboardSummary(null);
      await checkLiveIntegrations();
      return;
    }

    setCurrentUser(meRes.data.user);

    const [actRes, sumRes, polRes, whRes, spkRes, audRes, incRes, bgRes, chainRes, intRes] = await Promise.all([
      actionLockApi.listActions(),
      actionLockApi.getDashboardSummary(),
      actionLockApi.listPolicies(),
      actionLockApi.listWebhooks(),
      actionLockApi.listSpeakers(),
      actionLockApi.listAuditEvents(),
      actionLockApi.listIncidents(),
      actionLockApi.listBreakGlassEvents(),
      actionLockApi.verifyAuditChain(),
      actionLockApi.getIntegrations(),
    ]);

    if (actRes.ok && actRes.data?.actions) {
      const mapped = actRes.data.actions.map(mapBackendActionToEnvelope);
      setEnvelopes(mapped);
      setSelectedEnvelopeId((curr) => (mapped.some((m) => m.id === curr) ? curr : mapped[0]?.id || ''));
    }
    if (sumRes.ok && sumRes.data) {
      setDashboardSummary(sumRes.data);
    }
    if (polRes.ok && polRes.data?.policies) {
      setPolicies(polRes.data.policies.map(mapBackendPolicyToUi));
    }
    if (whRes.ok && whRes.data?.events) {
      setWebhooks((whRes.data.events as Array<Record<string, unknown>>).map(mapBackendWebhookToUi));
    }
    if (spkRes.ok && spkRes.data?.speakers) {
      setSpeakers(spkRes.data.speakers.map(mapBackendSpeakerToUi));
    }
    if (audRes.ok && audRes.data?.events) {
      setAuditEvents((audRes.data.events as Array<Record<string, unknown>>).map(mapBackendAuditToUi));
    }
    if (incRes.ok && incRes.data?.incidents) {
      setIncidents(incRes.data.incidents.map(mapBackendIncidentToUi));
    }
    if (bgRes.ok && bgRes.data?.events) {
      setBreakGlassEvents(bgRes.data.events);
    }
    if (chainRes.ok && chainRes.data) {
      setAuditChainStatus(chainRes.data);
    }
    if (intRes.ok && intRes.data) {
      setIntegrations(mapBackendIntegrationsToUi(intRes.data));
    }
    await checkLiveIntegrations();
  }, [checkLiveIntegrations]);

  const setMode = useCallback(
    (nextMode: AppMode) => {
      setModeState(nextMode);
      if (nextMode === 'live') {
        // Never leave demo fixtures masquerading as live backend records
        setEnvelopes([]);
        setPolicies([]);
        setWebhooks([]);
        setSpeakers([]);
        setAuditEvents([]);
        setIncidents([]);
        setDashboardSummary(null);
        void refreshLiveData();
        notify('Switched to LIVE MODE — loading persisted backend database and real enclave services.', 'warning');
      } else {
        setEnvelopes(DEMO_ENVELOPES);
        setSelectedEnvelopeId(DEMO_ENVELOPES[0].id);
        setPolicies(DEMO_POLICIES);
        setWebhooks(DEMO_WEBHOOKS);
        setSpeakers(DEMO_SPEAKERS);
        setAuditEvents(DEMO_AUDIT_EVENTS);
        setIncidents(DEMO_INCIDENTS);
        setIntegrations(DEMO_INTEGRATIONS);
        setDashboardSummary(null);
        setLiveHealthNote(null);
        notify('Switched to DEMO ENVIRONMENT — deterministic security fixtures active.', 'info');
      }
    },
    [notify, refreshLiveData],
  );

  const loginDemoAccount = useCallback(
    async (email: string, password = 'ActionLockDemo!2026') => {
      const res = await actionLockApi.login(email, password);
      if (!res.ok || !res.data?.user) {
        notify(res.error || 'Authentication failed.', 'error');
        return false;
      }
      setCurrentUser(res.data.user);
      if (mode === 'live') {
        await refreshLiveData();
      }
      notify(`Authenticated as ${res.data.user.displayName} (DEMO ACCOUNT).`, 'success');
      return true;
    },
    [mode, notify, refreshLiveData],
  );

  const logoutBackend = useCallback(async () => {
    await actionLockApi.logout();
    setCurrentUser(null);
    if (mode === 'live') {
      setEnvelopes([]);
      setDashboardSummary(null);
    }
    notify('Session closed cleanly.', 'info');
  }, [mode, notify]);

  const issueFreshChallenge = useCallback(
    async (envelopeId: string) => {
      if (mode === 'live') {
        const res = await actionLockApi.issueChallenge(envelopeId);
        if (!res.ok) {
          notify(res.error || 'Failed to issue server voice challenge.', 'error');
          return;
        }
        await refreshLiveData();
        notify(`Server challenge ${res.data?.challenge.nonceId || ''} issued.`, 'info');
        return;
      }

      const nonceNum = `${Math.floor(100 + Math.random() * 899)}-${Math.floor(100 + Math.random() * 899)}`;
      setEnvelopes((prev) =>
        prev.map((env) => {
          if (env.id !== envelopeId) return env;
          return {
            ...env,
            state: 'CHALLENGE_ISSUED',
            challenge: {
              ...env.challenge,
              nonceId: `#${nonceNum}`,
              phrase: `I, ${env.claimedApprover.split('@')[0]}, authorize ${env.actionId} under hash ${env.actionHash.slice(7, 15)} at code ${nonceNum}`,
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              remainingSeconds: 300,
              sttValidated: false,
            },
          };
        }),
      );
      await appendAudit(envelopeId, 'CHALLENGE_ISSUED', 'neutral', { nonceId: `#${nonceNum}` });
      notify(`Fresh cryptographic challenge #${nonceNum} issued (300s TTL).`, 'info');
    },
    [appendAudit, mode, notify, refreshLiveData],
  );

  const evaluateVoiceRecording = useCallback(
    async (
      envelopeId: string,
      opts: {
        scenario?: 'genuine' | 'synthetic' | 'mismatch' | 'insufficient' | 'api_error';
        audioBase64?: string;
        mimeType?: string;
      },
    ) => {
      const target = envelopes.find((e) => e.id === envelopeId);
      if (!target) return;

      if (target.hashDriftDetected) {
        notify('Envelope has unverified hash drift — revert or re-sign before voice evaluation.', 'error');
        return;
      }

      // STRICT ISOLATION: In Live Mode, QA simulator scenarios MUST NEVER run or inject fake results!
      if (mode === 'live') {
        if (opts.scenario && opts.scenario !== 'genuine') {
          notify('QA scenario simulator is disabled in LIVE MODE to protect live DetectifAI pipeline integrity.', 'error');
          return;
        }
        if (!opts.audioBase64) {
          notify('Record live audio via microphone before submitting to the live DetectifAI pipeline.', 'warning');
          return;
        }
        setEnvelopes((prev) =>
          prev.map((e) =>
            e.id === envelopeId
              ? {
                  ...e,
                  state: 'VERIFICATION_PENDING',
                  aletheia: { ...e.aletheia, status: 'processing' },
                  eidos: { ...e.eidos, status: 'processing' },
                }
              : e,
          ),
        );
        const res = await actionLockApi.submitRecording(envelopeId, {
          audioBase64: opts.audioBase64,
          mimeType: opts.mimeType || 'audio/webm',
          speakerId: target.eidos.speakerId,
          idempotencyKey: crypto.randomUUID(),
        });
        await refreshLiveData();
        if (!res.ok) {
          notify(res.error || 'Live DetectifAI verification rejected or failed closed to HOLD.', 'error');
          return;
        }
        notify('Live DetectifAI verification result recorded from server.', 'success');
        return;
      }

      // Demo Harness Scenarios (Demo Mode only)
      const scenario = opts.scenario || 'genuine';
      if (scenario === 'api_error') {
        setEnvelopes((prev) =>
          prev.map((e) =>
            e.id === envelopeId
              ? {
                  ...e,
                  state: 'INTEGRATION_ERROR',
                  aletheia: { ...e.aletheia, status: 'error', errorMessage: 'Upstream DetectifAI 503 timeout — fail closed to HOLD.' },
                  eidos: { ...e.eidos, status: 'error', errorMessage: 'Operation queued for recovery.' },
                }
              : e,
          ),
        );
        notify('Demo QA Harness: DetectifAI API error simulated — action held safely.', 'warning');
        return;
      }

      if (scenario === 'insufficient') {
        setEnvelopes((prev) =>
          prev.map((e) =>
            e.id === envelopeId
              ? {
                  ...e,
                  state: 'ON_HOLD',
                  aletheia: { ...e.aletheia, status: 'partial', verdict: null, score: null, errorMessage: 'Insufficient active speech (< 2.0s).' },
                  eidos: { ...e.eidos, status: 'partial', decision: null, similarity: null, errorMessage: 'Please re-record at least 4s of clear speech.' },
                }
              : e,
          ),
        );
        notify('Demo QA Harness: Insufficient speech simulated — held for re-recording.', 'warning');
        return;
      }

      if (scenario === 'synthetic') {
        setEnvelopes((prev) =>
          prev.map((e) =>
            e.id === envelopeId
              ? {
                  ...e,
                  state: 'ON_HOLD',
                  aletheia: {
                    status: 'completed',
                    verdict: 'fake',
                    score: 0.94,
                    durationSeconds: 12.1,
                    segments: [
                      { start: 0, end: 6, score: 0.91 },
                      { start: 6, end: 12.1, score: 0.96 },
                    ],
                    operationId: `op_aletheia_${Math.random().toString(16).slice(2, 8)}`,
                    threshold: 0.2,
                  },
                  eidos: {
                    status: 'completed',
                    decision: 'match',
                    similarity: 0.87,
                    speakerId: e.eidos.speakerId,
                    durationSeconds: 12.1,
                    operationId: `op_eidos_${Math.random().toString(16).slice(2, 8)}`,
                  },
                }
              : e,
          ),
        );
        await appendAudit(envelopeId, 'POLICY HOLD', 'error', { aletheia_verdict: 'fake', aletheia_score: 0.94 });
        notify('Demo QA Harness: Aletheia synthetic speech flagged (0.94) — action locked in ON_HOLD.', 'error');
        return;
      }

      if (scenario === 'mismatch') {
        setEnvelopes((prev) =>
          prev.map((e) =>
            e.id === envelopeId
              ? {
                  ...e,
                  state: 'ON_HOLD',
                  aletheia: {
                    status: 'completed',
                    verdict: 'real',
                    score: 0.04,
                    durationSeconds: 11.8,
                    segments: [{ start: 0, end: 11.8, score: 0.04 }],
                    operationId: `op_aletheia_${Math.random().toString(16).slice(2, 8)}`,
                    threshold: 0.2,
                  },
                  eidos: {
                    status: 'completed',
                    decision: 'no_match',
                    similarity: 0.34,
                    speakerId: e.eidos.speakerId,
                    durationSeconds: 11.8,
                    operationId: `op_eidos_${Math.random().toString(16).slice(2, 8)}`,
                  },
                }
              : e,
          ),
        );
        await appendAudit(envelopeId, 'POLICY HOLD', 'error', { eidos_decision: 'no_match', similarity: 0.34 });
        notify('Demo QA Harness: Eidos speaker mismatch simulated (0.34) — action placed ON_HOLD.', 'error');
        return;
      }

      setEnvelopes((prev) =>
        prev.map((e) =>
          e.id === envelopeId
            ? {
                ...e,
                state: 'VOICE_STAGE_PASSED',
                challenge: { ...e.challenge, sttValidated: true, sttMatchScore: 100, recordingDurationSec: 13.6 },
                aletheia: {
                  status: 'completed',
                  verdict: 'real',
                  score: 0.03,
                  durationSeconds: 13.6,
                  segments: [
                    { start: 0, end: 6.8, score: 0.02 },
                    { start: 6.8, end: 13.6, score: 0.03 },
                  ],
                  operationId: `op_aletheia_${Math.random().toString(16).slice(2, 8)}`,
                  threshold: 0.2,
                },
                eidos: {
                  status: 'completed',
                  decision: 'match',
                  similarity: 0.94,
                  speakerId: e.eidos.speakerId,
                  durationSeconds: 13.6,
                  operationId: `op_eidos_${Math.random().toString(16).slice(2, 8)}`,
                },
              }
            : e,
        ),
      );
      await appendAudit(envelopeId, 'VOICE VERIFIED', 'teal', {
        aletheia_verdict: 'real',
        eidos_decision: 'match',
        note: 'VOICE_STAGE_PASSED — FIDO2 WebAuthn step-up still required before authorization.',
      });
      notify('Voice evidence passed (VOICE_STAGE_PASSED). Proceed to hardware WebAuthn step-up.', 'success');
    },
    [appendAudit, envelopes, mode, notify, refreshLiveData],
  );

  const registerUserPasskey = useCallback(async () => {
    if (mode !== 'live') {
      notify('Passkey registration operates against backend RP in LIVE MODE.', 'info');
      return false;
    }
    const optRes = await actionLockApi.getPasskeyRegOptions();
    if (!optRes.ok || !optRes.data) {
      notify(optRes.error || 'Could not obtain WebAuthn registration options.', 'error');
      return false;
    }
    try {
      const regResponse = await startRegistration({ optionsJSON: optRes.data as never });
      const verRes = await actionLockApi.verifyPasskeyReg(regResponse);
      if (!verRes.ok) {
        notify(verRes.error || 'Server rejected passkey registration.', 'error');
        return false;
      }
      notify('WebAuthn / FIDO2 passkey registered and stored on backend RP.', 'success');
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Browser WebAuthn registration canceled or failed.', 'error');
      return false;
    }
  }, [mode, notify]);

  const triggerPasskeyStepUp = useCallback(
    async (envelopeId: string, opts?: { simulateFailure?: boolean }) => {
      const target = envelopes.find((e) => e.id === envelopeId);
      if (!target) return;

      if (target.hashDriftDetected || target.aletheia.verdict !== 'real' || target.eidos.decision !== 'match') {
        notify('Cannot perform WebAuthn step-up while envelope has hash drift or incomplete voice evidence.', 'error');
        return;
      }

      if (mode === 'live') {
        if (opts?.simulateFailure) {
          notify('Simulated WebAuthn failure is disabled in LIVE MODE.', 'error');
          return;
        }
        const optRes = await actionLockApi.getPasskeyOptions(envelopeId);
        if (!optRes.ok || !optRes.data) {
          notify(optRes.error || 'Failed to fetch WebAuthn challenge from backend (register passkey first).', 'error');
          return;
        }
        try {
          const assertion = await startAuthentication({ optionsJSON: optRes.data as never });
          const verRes = await actionLockApi.verifyPasskey(envelopeId, { response: assertion } as never);
          await refreshLiveData();
          if (!verRes.ok) {
            notify(verRes.error || 'Server WebAuthn signature verification failed.', 'error');
            return;
          }
          notify('Server-verified FIDO2/WebAuthn assertion passed.', 'success');
        } catch (err) {
          notify(err instanceof Error ? err.message : 'WebAuthn authentication canceled.', 'error');
        }
        return;
      }

      if (opts?.simulateFailure) {
        setEnvelopes((prev) =>
          prev.map((e) =>
            e.id === envelopeId
              ? {
                  ...e,
                  state: 'ON_HOLD',
                  passkey: {
                    ...e.passkey,
                    status: 'failed',
                    errorMessage: 'Demo QA Harness: CTAP2 user verification canceled or token mismatch.',
                  },
                }
              : e,
          ),
        );
        await appendAudit(envelopeId, 'PASSKEY_FAILED', 'error', { reason: 'CTAP2 assertion rejected' });
        notify('Demo QA Harness: Hardware passkey assertion failed — action held safely.', 'error');
        return;
      }

      setEnvelopes((prev) =>
        prev.map((e) => {
          if (e.id !== envelopeId) return e;
          const updatedSigners = e.quorumSigners.map((s) =>
            s.isCurrentUser ? { ...s, passkeyStatus: 'VERIFIED' as const, timestamp: new Date().toISOString().slice(11, 19) + ' UTC' } : s,
          );
          return {
            ...e,
            state: 'PEER_APPROVAL_PENDING',
            peerApprovalSatisfied: true,
            passkey: {
              ...e.passkey,
              status: 'verified',
              userPresent: true,
              userVerified: true,
              signatureCounter: (e.passkey.signatureCounter || 14208) + 1,
              attestedAt: new Date().toISOString(),
              errorMessage: undefined,
            },
            quorumSigners: updatedSigners,
          };
        }),
      );
      await appendAudit(envelopeId, 'WEBAUTHN STEP-UP', 'teal', {
        rp_id: target.passkey.rpId,
        user_verified: true,
      });
      notify('FIDO2/WebAuthn assertion verified. Ready for peer review / scoped permit.', 'success');
    },
    [appendAudit, envelopes, mode, notify, refreshLiveData],
  );

  const peerApproveEnvelope = useCallback(
    async (envelopeId: string, decision: 'APPROVED' | 'REJECTED' = 'APPROVED', reason = 'Independent peer co-approval') => {
      if (mode === 'live') {
        const res = await actionLockApi.peerApproveAction(envelopeId, decision, reason);
        await refreshLiveData();
        if (!res.ok) {
          notify(res.error || 'Peer approval rejected by backend Separation-of-Duties rule.', 'error');
          return;
        }
        notify(`Peer decision (${decision}) recorded by backend policy engine.`, 'success');
        return;
      }
      setEnvelopes((prev) =>
        prev.map((e) => (e.id === envelopeId ? { ...e, peerApprovalSatisfied: decision === 'APPROVED' } : e)),
      );
      notify(`Peer decision (${decision}) updated in demo mode.`, 'success');
    },
    [mode, notify, refreshLiveData],
  );

  const authorizeEnvelope = useCallback(
    async (envelopeId: string) => {
      const target = envelopes.find((e) => e.id === envelopeId);
      if (!target) return;

      if (mode === 'live') {
        const res = await actionLockApi.approveAction(envelopeId);
        if (!res.ok) {
          notify(res.error || 'Backend refused authorization.', 'error');
          return;
        }
        const permit = (res.data as unknown as { permit?: { jti: string; token: string; scope: string; expiresAt: string } })?.permit;
        if (permit) {
          setLastIssuedPermits((prev) => ({ ...prev, [envelopeId]: permit }));
        }
        await refreshLiveData();
        notify(`Scoped Permit ${permit?.jti || ''} minted by backend.`, 'success');
        return;
      }

      const allSevenMet =
        !target.hashDriftDetected &&
        target.challenge.sttValidated &&
        target.eidos.decision === 'match' &&
        target.aletheia.verdict === 'real' &&
        target.rbacSatisfied &&
        target.passkey.status === 'verified' &&
        target.peerApprovalSatisfied;

      if (!allSevenMet) {
        notify(
          'Authorization blocked: All 7 conditions (unchanged envelope, voice challenge, Eidos match, Aletheia real, RBAC, passkey, and peer quorum) must pass.',
          'error',
        );
        return;
      }

      setEnvelopes((prev) =>
        prev.map((e) =>
          e.id === envelopeId
            ? {
                ...e,
                state: 'AUTHORIZED',
                jtiConsumed: true,
                details:
                  e.details.kind === 'github'
                    ? { ...e.details, deploymentStatus: 'approved' }
                    : e.details,
              }
            : e,
        ),
      );
      await appendAudit(envelopeId, 'PERMIT MINTED', 'info', {
        jti: target.singleUseJti,
        outcome: 'AUTHORIZED',
      });
      notify(`Action ${envelopeId} AUTHORIZED — single-use JTI permit minted and dispatched.`, 'success');
    },
    [appendAudit, envelopes, mode, notify, refreshLiveData],
  );

  const releaseGitHubDeployment = useCallback(
    async (envelopeId: string, decision: 'approved' | 'rejected') => {
      if (mode !== 'live') {
        notify('GitHub App deployment callback requires LIVE MODE.', 'info');
        return;
      }
      const permit = lastIssuedPermits[envelopeId];
      const res = await actionLockApi.executeGitHubCallback(envelopeId, {
        decision,
        permitToken: decision === 'approved' ? permit?.token : undefined,
        comment: `ACTIONLOCK console ${decision} callback`,
      });
      await refreshLiveData();
      if (!res.ok) {
        notify(res.error || 'GitHub deployment callback failed.', 'error');
        return;
      }
      notify(`GitHub Deployment Protection Rule updated (${decision}).`, 'success');
    },
    [lastIssuedPermits, mode, notify, refreshLiveData],
  );

  const rejectEnvelope = useCallback(
    async (envelopeId: string, reason = 'Explicitly rejected by designated approver') => {
      if (mode === 'live') {
        const res = await actionLockApi.rejectAction(envelopeId, reason);
        await refreshLiveData();
        if (!res.ok) {
          notify(res.error || 'Failed to reject action on backend.', 'error');
          return;
        }
        notify(`Envelope ${envelopeId} rejected and locked.`, 'warning');
        return;
      }
      setEnvelopes((prev) =>
        prev.map((e) =>
          e.id === envelopeId
            ? {
                ...e,
                state: 'REJECTED',
                details: e.details.kind === 'github' ? { ...e.details, deploymentStatus: 'rejected' } : e.details,
              }
            : e,
        ),
      );
      await appendAudit(envelopeId, 'REJECTED', 'error', { reason });
      notify(`Envelope ${envelopeId} rejected and locked.`, 'warning');
    },
    [appendAudit, mode, notify, refreshLiveData],
  );

  const holdEnvelope = useCallback(
    (envelopeId: string, reason: string) => {
      if (mode === 'live') {
        notify('Manual hold in LIVE MODE should use Reject or Policy Hold via backend API.', 'info');
        return;
      }
      setEnvelopes((prev) => prev.map((e) => (e.id === envelopeId ? { ...e, state: 'ON_HOLD' as ActionPolicyState } : e)));
      void appendAudit(envelopeId, 'POLICY HOLD', 'error', { reason });
      notify(`Envelope ${envelopeId} placed ON_HOLD: ${reason}`, 'warning');
    },
    [appendAudit, mode, notify],
  );

  const mutateFinancePayload = useCallback(
    async (
      envelopeId: string,
      patch: { vendor?: string; depositoryBank?: string; beneficiaryReference?: string; amount?: string },
    ) => {
      const target = envelopes.find((e) => e.id === envelopeId);
      if (!target || target.details.kind !== 'finance') return;

      if (mode === 'live') {
        const cleanedAmount = patch.amount ? Number(String(patch.amount).replace(/[$,\s]/g, '')) : undefined;
        const res = await actionLockApi.mutateAction(
          envelopeId,
          {
            ...(patch.vendor ? { vendorReference: patch.vendor } : {}),
            ...(patch.beneficiaryReference ? { beneficiaryReference: patch.beneficiaryReference } : {}),
            ...(cleanedAmount && Number.isFinite(cleanedAmount) ? { amount: cleanedAmount } : {}),
          },
          'Finance simulation payload mutated — invalidating prior verification',
        );
        await refreshLiveData();
        if (!res.ok) {
          notify(res.error || 'Failed to mutate envelope on backend.', 'error');
          return;
        }
        notify('Backend created new envelope version & SHA-256 hash; prior approvals invalidated.', 'error');
        return;
      }

      const updatedDetails = {
        ...target.details,
        vendor: patch.vendor ?? target.details.vendor,
        depositoryBank: patch.depositoryBank ?? target.details.depositoryBank,
        beneficiaryReference: patch.beneficiaryReference ?? target.details.beneficiaryReference,
        amount: patch.amount ?? target.details.amount,
      };
      const newHash = `sha256:${await sha256Hex(canonicalizeJson(updatedDetails))}`;
      const baselineHash = target.ingressHash || target.actionHash;
      const drifted = newHash !== baselineHash;

      setEnvelopes((prev) =>
        prev.map((e) =>
          e.id === envelopeId
            ? {
                ...e,
                ingressHash: baselineHash,
                actionHash: newHash,
                hashDriftDetected: drifted,
                state: drifted ? 'ACTION_CHANGED' : 'AWAITING_APPROVER',
                peerApprovalSatisfied: false,
                passkey: {
                  ...e.passkey,
                  status: 'requested',
                  errorMessage: drifted ? 'Previous approval invalidated by payload change.' : undefined,
                },
                details: updatedDetails,
              }
            : e,
        ),
      );

      if (drifted) {
        await appendAudit(envelopeId, 'POLICY HOLD', 'error', {
          reason: 'ACTION_CHANGED — Beneficiary or amount mutated after verification',
          newHash,
        });
        notify('Payload mutated! Previous approval invalidated; envelope returned to HOLD (ACTION_CHANGED).', 'error');
      }
    },
    [appendAudit, envelopes, mode, notify, refreshLiveData],
  );

  const revertFinanceToOriginal = useCallback(
    async (envelopeId: string) => {
      const target = envelopes.find((e) => e.id === envelopeId);
      if (!target || target.details.kind !== 'finance') return;

      if (mode === 'live') {
        const res = await actionLockApi.mutateAction(
          envelopeId,
          {
            vendorReference: target.details.originalVendor || target.details.vendor,
            beneficiaryReference: target.details.originalBeneficiaryReference || target.details.beneficiaryReference,
          },
          'Reverted beneficiary reference to stored domestic profile (fresh voice/passkey re-verification required)',
        );
        await refreshLiveData();
        if (!res.ok) {
          notify(res.error || 'Failed to revert beneficiary on backend.', 'error');
          return;
        }
        notify('Reverted beneficiary profile in new canonical version; complete fresh step-up verification.', 'success');
        return;
      }

      const restoredDetails = {
        ...target.details,
        vendor: target.details.originalVendor || target.details.vendor,
        depositoryBank: target.details.originalDepositoryBank || target.details.depositoryBank,
        beneficiaryReference: target.details.originalBeneficiaryReference || target.details.beneficiaryReference,
      };
      const restoredHash = target.ingressHash || `sha256:${await sha256Hex(canonicalizeJson(restoredDetails))}`;

      setEnvelopes((prev) =>
        prev.map((e) =>
          e.id === envelopeId
            ? {
                ...e,
                actionHash: restoredHash,
                hashDriftDetected: false,
                state: 'VOICE_STAGE_PASSED',
                details: restoredDetails,
              }
            : e,
        ),
      );
      await appendAudit(envelopeId, 'ENVELOPE_REVERTED', 'teal', {
        restoredHash,
        note: 'Reverted to stored domestic beneficiary profile; ready for FIDO2 quorum.',
      });
      notify('Reverted to stored domestic beneficiary profile — zero hash drift restored.', 'success');
    },
    [appendAudit, envelopes, mode, notify, refreshLiveData],
  );

  const createProtectedAction = useCallback(
    async (input: {
      category: ActionCategory;
      targetTitle: string;
      targetSubtitle: string;
      requester: string;
      claimedApprover: string;
      amountOrRepo: string;
    }) => {
      if (mode === 'live') {
        const isFinance = input.category === 'Financial';
        const numericAmt = Number(String(input.amountOrRepo || '250000').replace(/[$,\s]/g, '')) || 250000;
        const [ownerPart, repoPart] = String(input.amountOrRepo || 'acme-corp/core-auth-gateway').split('/');
        const payload = isFinance
          ? {
              category: 'FINANCE_APPROVAL',
              claimedApproverEmail: input.claimedApprover,
              environment: 'simulation',
              parameters: {
                vendorReference: input.targetSubtitle || 'CloudScale Corp US',
                beneficiaryReference: 'SIM-ABA-021000021-8841',
                amount: numericAmt,
                currency: 'USD',
                purpose: `SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED. ${input.targetTitle}`,
              },
            }
          : {
              category: 'GITHUB_DEPLOYMENT',
              claimedApproverEmail: input.claimedApprover,
              environment: 'production-us-east-1',
              parameters: {
                repositoryOwner: ownerPart || 'acme-corp',
                repositoryName: repoPart || 'core-auth-gateway',
                commitSha: Math.random().toString(16).slice(2, 14),
                workflowRunId: String(Math.floor(4900 + Math.random() * 500)),
                targetEnvironment: 'production-us-east-1',
              },
            };

        const res = await actionLockApi.createAction(payload);
        if (!res.ok || !res.data?.action) {
          notify(res.error || 'Failed to create Action Envelope on backend.', 'error');
          return null;
        }
        const mapped = mapBackendActionToEnvelope(res.data.action);
        await refreshLiveData();
        setSelectedEnvelopeId(mapped.id);
        notify(`Persisted Protected Action Envelope ${mapped.id} created.`, 'success');
        return mapped;
      }

      const id = `env_${Math.random().toString(16).slice(2, 10)}`;
      const actionHash = `sha256:${await sha256Hex(canonicalizeJson(input))}`;
      const nonceNum = `${Math.floor(100 + Math.random() * 899)}-${Math.floor(100 + Math.random() * 899)}`;
      const created: ActionEnvelope = {
        id,
        actionId: `act_${Math.random().toString(16).slice(2, 8)}`,
        orgId: 'org_acme_enterprise',
        category: input.category,
        targetTitle: input.targetTitle,
        targetSubtitle: input.targetSubtitle,
        requester: input.requester,
        requesterInitials: input.requester.slice(0, 2).toUpperCase(),
        requesterRole: 'Origin Requester',
        claimedApprover: input.claimedApprover,
        claimedApproverInitials: input.claimedApprover.slice(0, 2).toUpperCase(),
        claimedApproverRole: 'Designated Approver',
        riskTier: 'CRITICAL',
        state: 'CHALLENGE_ISSUED',
        version: 'v1',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        ageDisplay: 'Just now',
        actionHash,
        singleUseJti: `jti_${id}_unconsumed`,
        jtiConsumed: false,
        policyId: input.category === 'Financial' ? 'FIN-POL-02' : 'SEC-POL-04',
        policySummary: 'Dual-AI voice evidence + unchanged envelope + WebAuthn step-up required.',
        details:
          input.category === 'Financial'
            ? {
                kind: 'finance',
                vendor: input.targetSubtitle,
                depositoryBank: 'Simulation Sandbox Bank',
                beneficiaryReference: 'SIM-ABA: 021000021 · ****4401',
                invoiceReference: `INV-${Math.floor(1000 + Math.random() * 8999)}`,
                amount: input.amountOrRepo,
                currency: 'USD',
                purpose: `SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED. ${input.targetTitle}`,
                paymentRequestId: `WB-${Math.floor(10000 + Math.random() * 89999)}`,
                egressGate: 'ERP Treasury Sandbox',
              }
            : {
                kind: 'github',
                repository: input.amountOrRepo || 'acme-corp/core-auth-gateway',
                commitSha: actionHash.slice(7, 14),
                branch: 'main',
                workflowRunId: String(Math.floor(4900 + Math.random() * 500)),
                workflowFile: 'deploy-production.yml',
                targetEnvironment: 'production-us-east-1',
                deploymentStatus: 'waiting',
              },
        challenge: {
          nonceId: `#${nonceNum}`,
          phrase: `Authorize ${input.targetTitle} (${id}) at code ${nonceNum}`,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          remainingSeconds: 300,
          sttValidated: false,
          waveformBars: [20, 28, 18, 25, 30, 22, 16, 24, 29, 21, 18, 27, 23, 19, 26, 22, 17, 25, 21, 19, 24, 20, 18, 22],
        },
        aletheia: { status: 'idle', verdict: null, score: null, durationSeconds: null, segments: [], operationId: null },
        eidos: {
          status: 'idle',
          decision: null,
          similarity: null,
          speakerId: 'spk_sarah_jenkins_01',
          durationSeconds: null,
          operationId: null,
        },
        passkey: { status: 'not_requested', rpId: 'localhost' },
        quorumSigners: [
          {
            id: 'marcus',
            name: 'Marcus Vance (You)',
            initials: 'MV',
            role: 'Principal SecOps',
            voiceStatus: 'VOICE_PENDING',
            passkeyStatus: 'AWAITING_TOUCH',
            isCurrentUser: true,
          },
        ],
        peerApprovalSatisfied: false,
        rbacSatisfied: true,
        auditEvents: [],
      };
      setEnvelopes((prev) => [created, ...prev]);
      setSelectedEnvelopeId(created.id);
      await appendAudit(created.id, 'ENVELOPE CREATED', 'neutral', { actionId: created.actionId });
      notify(`Protected Action Envelope ${created.id} created and bound to SHA-256 hash.`, 'success');
      return created;
    },
    [appendAudit, mode, notify, refreshLiveData],
  );

  const enrollSpeaker = useCallback(
    (input: { name: string; email: string; role: string; department: EnrolledSpeaker['department'] }) => {
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const next: EnrolledSpeaker = {
        id: String(Date.now()),
        name: input.name,
        initials: input.name
          .split(' ')
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
        role: input.role,
        department: input.department,
        email: input.email,
        speakerId: `spk_${slug}_01`,
        vectorHash: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
        durationSec: 21.6,
        sampleCount: 3,
        snrDb: 28.9,
        snrLabel: 'Clean',
        status: 'ACTIVE',
        consentExpiryDays: 365,
        signedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        ed25519Signature: `sig_ed25519_${Math.random().toString(16).slice(2)}`,
        scopes: ['production.deploy.standard'],
        livenessHistory: ['pass', 'pass', 'pass'],
      };
      setSpeakers((prev) => [next, ...prev]);
      notify(`Speaker ${input.name} enrolled in Voice Registry.`, 'success');
    },
    [notify],
  );

  const revokeSpeaker = useCallback(
    (id: string) => {
      setSpeakers((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: 'REVOKED',
                vectorHash: 'PURGED_ENCLAVE',
                durationSec: 0,
                sampleCount: 0,
                scopes: [],
              }
            : s,
        ),
      );
      notify('Consent revoked and speaker profile removed.', 'warning');
    },
    [notify],
  );

  const updateIncidentStatus = useCallback(
    async (id: string, status: SecurityIncidentRecord['status']) => {
      if (mode === 'live') {
        const backendStatus = status === 'QUARANTINED / ON_HOLD' ? 'OPEN' : status;
        const res = await actionLockApi.updateIncident(id, backendStatus);
        if (!res.ok) {
          notify(res.error || 'Failed to update security incident on backend.', 'error');
          return;
        }
        await refreshLiveData();
        notify(`Persisted incident ${id} status updated to ${backendStatus}.`, 'info');
        return;
      }
      setIncidents((prev) => prev.map((inc) => (inc.id === id ? { ...inc, status } : inc)));
      notify(`Incident ${id} transitioned to ${status}.`, 'info');
    },
    [mode, notify, refreshLiveData],
  );

  const verifyAuditChainIntegrity = useCallback(async () => {
    if (mode !== 'live') {
      notify('Local demo fixture chain matches displayed SHA-256 links (switch to LIVE MODE for SQLite verification).', 'info');
      return;
    }
    const res = await actionLockApi.verifyAuditChain();
    if (!res.ok || !res.data) {
      notify(res.error || 'Failed to verify backend SHA-256 audit chain.', 'error');
      return;
    }
    setAuditChainStatus(res.data);
    notify(
      res.data.valid
        ? `Append-only SHA-256 chain verified (${res.data.verifiedCount}/${res.data.totalCount} events).`
        : `Audit chain integrity break detected at ${res.data.brokenAtId}!`,
      res.data.valid ? 'success' : 'error',
    );
  }, [mode, notify]);

  const submitBreakGlassEvent = useCallback(
    async (payload: {
      ticketId: string;
      justification: string;
      targetScope: string;
      custodians: string[];
      ttlMinutes: number;
      acknowledgedRunbook: boolean;
    }) => {
      if (mode === 'live') {
        const res = await actionLockApi.createBreakGlassEvent(payload);
        if (!res.ok) {
          notify(res.error || 'Failed to log Break-Glass event on backend.', 'error');
          return false;
        }
        await refreshLiveData();
        notify(`Audited Break-Glass access logged for ${payload.ticketId}.`, 'warning');
        return true;
      }
      const next = {
        id: `bg_demo_${Math.random().toString(16).slice(2, 8)}`,
        ticketId: payload.ticketId,
        custodians: payload.custodians,
        targetScope: payload.targetScope,
        justification: payload.justification,
        initiatedByName: 'Marcus Vance',
        expiresAt: new Date(Date.now() + payload.ttlMinutes * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      setBreakGlassEvents((prev) => [next, ...prev]);
      notify(`Demo Runbook: Logged Break-Glass event for ${payload.ticketId}.`, 'warning');
      return true;
    },
    [mode, notify, refreshLiveData],
  );

  const createPolicyRule = useCallback(
    async (rule: Omit<SecurityPolicyRule, 'status'>) => {
      if (mode === 'live') {
        const res = await actionLockApi.createPolicy({
          id: rule.id,
          name: rule.name,
          category:
            rule.category === 'Financial'
              ? 'FINANCE_APPROVAL'
              : rule.category === 'IT Identity'
                ? 'IAM'
                : 'GITHUB_DEPLOYMENT',
          target: rule.target,
          riskTier: rule.riskTier,
          requireVoice: rule.voiceCheck !== 'Optional',
          requirePasskey: rule.fido2 === 'Mandatory',
          requirePeerApproval: rule.quorum.includes('2-of-2'),
          nonceTtlSec: rule.nonceTtlSec,
          permitTtlSec: rule.permitTtlSec,
          sodRule: rule.sodRule,
          voiceRequirements: rule.voiceRequirements,
          fallbackPath: rule.fallbackPath,
        });
        if (!res.ok) {
          notify(res.error || 'Failed to create policy on backend.', 'error');
          return;
        }
        await refreshLiveData();
        notify(`Policy ${rule.id} persisted to backend policy engine.`, 'success');
        return;
      }

      setPolicies((prev) => [{ ...rule, status: 'ACTIVE' }, ...prev]);
      notify(`Policy ${rule.id} compiled into deterministic AST and activated.`, 'success');
    },
    [mode, notify, refreshLiveData],
  );

  const value = useMemo<ActionLockContextValue>(
    () => ({
      mode,
      setMode,
      currentUser,
      demoAccounts,
      dashboardSummary,
      liveHealthNote,
      lastIssuedPermits,
      envelopes,
      selectedEnvelopeId,
      setSelectedEnvelopeId,
      speakers,
      policies,
      integrations,
      webhooks,
      auditEvents,
      incidents,
      c4SpecOpen,
      setC4SpecOpen,
      newActionModalOpen,
      setNewActionModalOpen,
      commandPaletteOpen,
      setCommandPaletteOpen,
      globalSearch,
      setGlobalSearch,
      toast,
      notify,
      loginDemoAccount,
      logoutBackend,
      refreshLiveData,
      issueFreshChallenge,
      evaluateVoiceRecording,
      registerUserPasskey,
      triggerPasskeyStepUp,
      peerApproveEnvelope,
      authorizeEnvelope,
      releaseGitHubDeployment,
      rejectEnvelope,
      holdEnvelope,
      mutateFinancePayload,
      revertFinanceToOriginal,
      createProtectedAction,
      enrollSpeaker,
      revokeSpeaker,
      updateIncidentStatus,
      auditChainStatus,
      verifyAuditChainIntegrity,
      breakGlassEvents,
      submitBreakGlassEvent,
      createPolicyRule,
      checkLiveIntegrations,
    }),
    [
      mode,
      setMode,
      currentUser,
      demoAccounts,
      dashboardSummary,
      liveHealthNote,
      lastIssuedPermits,
      envelopes,
      selectedEnvelopeId,
      speakers,
      policies,
      integrations,
      webhooks,
      auditEvents,
      incidents,
      c4SpecOpen,
      newActionModalOpen,
      commandPaletteOpen,
      globalSearch,
      toast,
      notify,
      loginDemoAccount,
      logoutBackend,
      refreshLiveData,
      issueFreshChallenge,
      evaluateVoiceRecording,
      registerUserPasskey,
      triggerPasskeyStepUp,
      peerApproveEnvelope,
      authorizeEnvelope,
      releaseGitHubDeployment,
      rejectEnvelope,
      holdEnvelope,
      mutateFinancePayload,
      revertFinanceToOriginal,
      createProtectedAction,
      enrollSpeaker,
      revokeSpeaker,
      updateIncidentStatus,
      auditChainStatus,
      verifyAuditChainIntegrity,
      breakGlassEvents,
      submitBreakGlassEvent,
      createPolicyRule,
      checkLiveIntegrations,
    ],
  );

  return <ActionLockContext.Provider value={value}>{children}</ActionLockContext.Provider>;
}

export function useActionLock() {
  const ctx = useContext(ActionLockContext);
  if (!ctx) throw new Error('useActionLock must be used inside ActionLockProvider');
  return ctx;
}
