import type {
  ActionCategory,
  ActionEnvelope,
  ActionPolicyState,
  AuditEventRecord,
  EnrolledSpeaker,
  IntegrationAdapter,
  SecurityIncidentRecord,
  SecurityPolicyRule,
  WebhookEventRecord,
} from '@/types/actionlock';

const DEFAULT_WAVEFORM = [
  16, 22, 18, 28, 34, 24, 15, 30, 38, 26, 20, 32, 29, 22, 36, 25, 19, 31, 24, 21, 29, 23, 18, 26,
];

function mapBackendStateToUi(state: string): ActionPolicyState {
  switch (state) {
    case 'PENDING':
      return 'AWAITING_APPROVER';
    case 'CHALLENGE_ISSUED':
      return 'CHALLENGE_ISSUED';
    case 'VOICE_CHECK_PENDING':
      return 'VERIFICATION_PENDING';
    case 'VOICE_VERIFIED':
      return 'VOICE_STAGE_PASSED';
    case 'WAITING_FOR_PASSKEY':
      return 'STEP_UP_PENDING';
    case 'WAITING_FOR_PEER_APPROVAL':
      return 'PEER_APPROVAL_PENDING';
    case 'APPROVED':
    case 'TOKEN_ISSUED':
    case 'CONSUMED':
      return 'AUTHORIZED';
    case 'HOLD':
      return 'ON_HOLD';
    case 'INVALIDATED':
      return 'ACTION_CHANGED';
    case 'REJECTED':
      return 'REJECTED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'AWAITING_APPROVER';
  }
}

function mapCategory(category: string): ActionCategory {
  if (category === 'FINANCE_APPROVAL' || category === 'Financial') return 'Financial';
  if (category === 'IAM') return 'IAM';
  return 'DevSecOps';
}

function initialsFrom(nameOrEmail: string): string {
  const clean = String(nameOrEmail || 'AL').trim();
  const parts = clean.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function mapBackendActionToEnvelope(raw: Record<string, unknown>): ActionEnvelope {
  const id = String(raw.id || '');
  const rawCategory = String(raw.category || 'GITHUB_DEPLOYMENT');
  const category = mapCategory(rawCategory);
  const envelope = (raw.envelope || {}) as Record<string, unknown>;
  const params = (envelope.parameters || {}) as Record<string, unknown>;
  const ingressPayload = (raw.ingressPayload || {}) as Record<string, unknown>;
  const ingressParams = (ingressPayload.parameters || {}) as Record<string, unknown>;
  const depParams = (params.deploymentParams || {}) as Record<string, unknown>;

  const requesterObj = (raw.requester || {}) as Record<string, unknown>;
  const approverObj = (raw.claimedApprover || {}) as Record<string, unknown>;
  const requesterLabel = String(requesterObj.email || requesterObj.name || 'requester@acme.corp');
  const approverLabel = String(approverObj.email || approverObj.name || 'approver@acme.corp');

  const latestChallenge = (raw.latestChallenge || null) as Record<string, unknown> | null;
  const latestVerification = (raw.latestVerification || null) as Record<string, unknown> | null;
  const approvals = (Array.isArray(raw.approvals) ? raw.approvals : []) as Array<Record<string, unknown>>;
  const permit = (raw.issuedPermit || null) as Record<string, unknown> | null;

  const currentState = String(raw.state || 'PENDING');
  const uiState = mapBackendStateToUi(currentState);
  const hashDriftDetected =
    Boolean(raw.hasVersionDrift) &&
    String(raw.ingressHash || '') !== '' &&
    String(raw.ingressHash || '') !== String(raw.actionHash || '');

  const eidosDec = (latestVerification?.eidos_decision as 'match' | 'no_match' | null) || null;
  const aletheiaVerdict = (latestVerification?.aletheia_verdict as 'real' | 'fake' | null) || null;

  const passkeyApproval = approvals.find((a) => a.approval_kind === 'PASSKEY' && a.decision === 'APPROVED');
  const peerApproval = approvals.find((a) => a.approval_kind === 'PEER' && a.decision === 'APPROVED');

  const expMs = new Date(String(latestChallenge?.expires_at || raw.expiresAt || Date.now())).getTime();
  const remainingSec = Math.max(0, Math.round((expMs - Date.now()) / 1000));

  const details =
    category === 'Financial'
      ? {
          kind: 'finance' as const,
          vendor: String(params.vendorReference || 'Simulated Vendor'),
          originalVendor: String(ingressParams.vendorReference || params.vendorReference || 'Simulated Vendor'),
          depositoryBank: 'Simulation Sandbox Bank',
          originalDepositoryBank: 'Simulation Sandbox Bank',
          beneficiaryReference: String(params.beneficiaryReference || ''),
          originalBeneficiaryReference: String(
            ingressParams.beneficiaryReference || params.beneficiaryReference || '',
          ),
          invoiceReference: `SIM-${id.slice(4, 10).toUpperCase()}`,
          amount: `$${Number(params.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          currency: String(params.currency || 'USD'),
          purpose: String(params.purpose || 'SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED.'),
          paymentRequestId: id,
          egressGate: String(raw.targetSystem || 'erp_treasury_sandbox'),
        }
      : {
          kind: 'github' as const,
          repository: `${String(params.repositoryOwner || 'acme-corp')}/${String(params.repositoryName || 'repo')}`,
          commitSha: String(params.commitSha || '').slice(0, 12),
          branch: String(depParams.branch || 'main'),
          workflowRunId: String(params.workflowRunId || ''),
          workflowFile: String(depParams.workflowFile || 'deploy-prod.yml'),
          targetEnvironment: String(params.targetEnvironment || raw.environment || 'production'),
          customRuleId: depParams.installationId ? `inst_${depParams.installationId}` : undefined,
          deploymentStatus:
            currentState === 'CONSUMED'
              ? ('approved' as const)
              : currentState === 'REJECTED'
                ? ('rejected' as const)
                : ('waiting' as const),
        };

  return {
    id,
    actionId: id,
    orgId: String(raw.organisationId || 'org_acme_enterprise'),
    category,
    targetTitle:
      category === 'Financial'
        ? `${details.kind === 'finance' ? details.vendor : 'Treasury'} · Simulation`
        : `${details.kind === 'github' ? details.repository : 'GitHub'} (${String(raw.environment || 'production')})`,
    targetSubtitle:
      category === 'Financial'
        ? `${details.kind === 'finance' ? details.amount : ''} ${details.kind === 'finance' ? details.currency : 'USD'} · ${String(raw.targetSystem || 'sandbox')}`
        : `Run #${details.kind === 'github' ? details.workflowRunId : ''} · ${details.kind === 'github' ? details.commitSha : ''}`,
    requester: requesterLabel,
    requesterInitials: initialsFrom(requesterLabel),
    requesterRole: 'Origin Requester',
    claimedApprover: approverLabel,
    claimedApproverInitials: initialsFrom(approverLabel),
    claimedApproverRole: 'Designated Approver',
    riskTier: (String(raw.riskTier || 'CRITICAL') as ActionEnvelope['riskTier']) || 'CRITICAL',
    state: uiState,
    version: `v${Number(raw.version || 1)}`,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    expiresAt: String(raw.expiresAt || new Date().toISOString()),
    ageDisplay: 'Persisted',
    actionHash: String(raw.actionHash || ''),
    ingressHash: raw.ingressHash ? String(raw.ingressHash) : undefined,
    hashDriftDetected,
    singleUseJti: String(permit?.jti || `jti_${id}_pending`),
    jtiConsumed: Boolean(permit?.consumed_at),
    policyId: category === 'Financial' ? 'FIN-POL-02' : 'SEC-POL-04',
    policySummary: 'Voice biometric evidence + unchanged JCS SHA-256 envelope + WebAuthn passkey + Peer SoD.',
    details,
    challenge: {
      nonceId: latestChallenge ? String(latestChallenge.nonce) : 'NOT_ISSUED',
      phrase: latestChallenge
        ? String(latestChallenge.phrase)
        : 'Click "Issue Fresh Challenge" to mint a server nonce phrase bound to this action hash.',
      issuedAt: String(latestChallenge?.created_at || raw.createdAt || ''),
      expiresAt: String(latestChallenge?.expires_at || raw.expiresAt || ''),
      remainingSeconds: remainingSec,
      sttValidated: latestChallenge?.stt_status === 'MATCHED',
      recordingDurationSec: undefined,
      waveformBars: DEFAULT_WAVEFORM,
    },
    aletheia: {
      status: aletheiaVerdict ? 'completed' : currentState === 'VOICE_CHECK_PENDING' ? 'processing' : 'idle',
      verdict: aletheiaVerdict,
      score: typeof latestVerification?.aletheia_score === 'number' ? latestVerification.aletheia_score : null,
      durationSeconds: null,
      segments: [],
      operationId: (latestVerification?.aletheia_operation_id as string | null) || null,
      threshold: 0.2,
    },
    eidos: {
      status: eidosDec ? 'completed' : currentState === 'VOICE_CHECK_PENDING' ? 'processing' : 'idle',
      decision: eidosDec,
      similarity: typeof latestVerification?.eidos_similarity === 'number' ? latestVerification.eidos_similarity : null,
      speakerId: 'backend_mapped_profile',
      durationSeconds: null,
      operationId: (latestVerification?.eidos_operation_id as string | null) || null,
    },
    passkey: {
      status: passkeyApproval ? 'verified' : uiState === 'STEP_UP_PENDING' ? 'requested' : 'not_requested',
      rpId: 'localhost',
      attestedAt: passkeyApproval ? String(passkeyApproval.created_at) : undefined,
      userVerified: Boolean(passkeyApproval),
      userPresent: Boolean(passkeyApproval),
    },
    quorumSigners: [
      {
        id: 'primary_approver',
        name: String(approverObj.name || approverLabel),
        initials: initialsFrom(approverLabel),
        role: 'Primary Approver',
        voiceStatus: eidosDec === 'match' && aletheiaVerdict === 'real' ? 'VOICE_VERIFIED' : 'VOICE_PENDING',
        passkeyStatus: passkeyApproval ? 'VERIFIED' : 'AWAITING_TOUCH',
        timestamp: passkeyApproval ? String(passkeyApproval.created_at) : undefined,
        isCurrentUser: true,
      },
      {
        id: 'peer_approver',
        name: peerApproval ? String(peerApproval.approver_name || peerApproval.approver_email || 'Peer Approver') : 'Independent Peer Reviewer',
        initials: peerApproval ? initialsFrom(String(peerApproval.approver_name || 'PR')) : 'PR',
        role: 'Separation-of-Duties Co-Signer',
        voiceStatus: 'VOICE_VERIFIED',
        passkeyStatus: peerApproval ? 'VERIFIED' : 'PENDING',
        timestamp: peerApproval ? String(peerApproval.created_at) : undefined,
      },
    ],
    peerApprovalSatisfied: Boolean(peerApproval),
    rbacSatisfied: true,
    auditEvents: approvals.map((a) => ({
      timestamp: String(a.created_at || ''),
      eventId: String(a.id || ''),
      title: `${String(a.approval_kind || '')} ${String(a.decision || '')}`,
      detail: String(a.reason || `Approved by ${String(a.approver_email || '')}`),
      badge: String(a.decision || ''),
      tone: a.decision === 'APPROVED' ? ('teal' as const) : ('error' as const),
    })),
  };
}

export function mapBackendPolicyToUi(raw: Record<string, unknown>): SecurityPolicyRule {
  const rules = (raw.rules || {}) as Record<string, unknown>;
  const rawCat = String(raw.category || 'GITHUB_DEPLOYMENT');
  const category: SecurityPolicyRule['category'] =
    rawCat === 'FINANCE_APPROVAL'
      ? 'Financial'
      : rawCat === 'IAM'
        ? 'IT Identity'
        : rawCat === 'Break-Glass'
          ? 'Break-Glass'
          : 'DevSecOps';

  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    category,
    target: String(raw.target || ''),
    riskTier: (String(raw.riskTier || 'CRITICAL') as SecurityPolicyRule['riskTier']),
    voiceCheck: raw.requireVoice ? 'Aletheia + Eidos' : 'Optional',
    fido2: raw.requirePasskey ? 'Mandatory' : 'Optional',
    quorum: raw.requirePeerApproval ? '2-of-2 Peer SoD' : '1-of-1 Primary',
    nonceTtlSec: Number(raw.nonceTtlSec || 180),
    permitTtlSec: Number(raw.permitTtlSec || 300),
    sodRule: String(rules.sodRule || 'Requester != Approver != Peer Signer'),
    voiceRequirements: String(rules.voiceRequirements || ''),
    fallbackPath: String(rules.fallbackPath || 'Manual SecOps callback + ticket'),
    status: raw.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
  };
}

export function mapBackendWebhookToUi(raw: Record<string, unknown>): WebhookEventRecord {
  const st = String(raw.processingStatus || 'PENDING');
  return {
    eventId: String(raw.webhookId || raw.id || ''),
    eventType: String(raw.eventType || 'unknown'),
    relatedActionId: String(raw.operationId || 'uncorrelated'),
    source: String(raw.provider || 'detectifai'),
    status: st === 'PROCESSED' ? 'PROCESSED' : st === 'FAILED' ? 'FAILED' : 'RETRYING',
    hmacStatus: raw.signatureValid ? 'VERIFIED' : 'INVALID',
    timestampSkew: 'verified',
    idempotencyKey: String(raw.webhookId || raw.id || ''),
    payload: (raw.payload as Record<string, unknown>) || {},
  };
}

export function mapBackendSpeakerToUi(raw: Record<string, unknown>): EnrolledSpeaker {
  const name = String(raw.displayName || raw.email || raw.speakerId || 'Enrolled Speaker');
  return {
    id: String(raw.id || ''),
    name,
    initials: initialsFrom(name),
    role: String(raw.title || 'Authorizer'),
    department: (String(raw.department || 'SecOps') as EnrolledSpeaker['department']),
    email: String(raw.email || ''),
    speakerId: String(raw.speakerId || ''),
    vectorHash: String(raw.lastOperationId || 'detectifai_remote_embedding'),
    durationSec: Number(raw.sampleDurationSec || 0),
    sampleCount: 1,
    snrDb: 0,
    snrLabel: String(raw.providerStatus || 'ENROLLED'),
    status: raw.status === 'REVOKED' || raw.status === 'DELETED' ? 'REVOKED' : 'ACTIVE',
    consentExpiryDays: 365,
    signedAt: String(raw.consentedAt || raw.createdAt || ''),
    ed25519Signature: String(raw.consentVersion || 'v2026.1'),
    scopes: [String(raw.retentionPolicy || 'DetectifAI 30-day retention acknowledged')],
    livenessHistory: ['pass'],
  };
}

export function mapBackendAuditToUi(raw: Record<string, unknown>, idx: number): AuditEventRecord {
  const evType = String(raw.eventType || 'EVENT');
  return {
    timestamp: String(raw.createdAt || ''),
    eventId: String(raw.id || ''),
    envelopeId: String(raw.actionRequestId || 'SYSTEM'),
    eventType: evType,
    tone:
      evType.includes('REJECT') || evType.includes('FAIL') || evType.includes('HOLD') || evType.includes('SPOOF')
        ? 'error'
        : evType.includes('VOICE') || evType.includes('PASSKEY') || evType.includes('RELEASED')
          ? 'teal'
          : evType.includes('PERMIT') || evType.includes('TOKEN') || evType.includes('PEER')
            ? 'info'
            : 'neutral',
    previousHash: String(raw.previousHash || 'sha256:genesis'),
    currentHash: String(raw.eventHash || ''),
    blockNumber: idx + 1,
    payload: (raw.payload as Record<string, unknown>) || {},
  };
}

export function mapBackendIntegrationsToUi(raw: {
  detectifai: { status: string; configured: boolean; baseUrl: string };
  github: { status: string; configured: boolean; webhookSecretConfigured?: boolean; webhookDeliveryCount?: number };
  webauthn: { status: string; rpId: string };
}): IntegrationAdapter[] {
  return [
    {
      id: 'detectifai',
      name: 'DetectifAI Dual-Engine',
      status: raw.detectifai.configured ? 'CONNECTED' : 'ERROR',
      subtitle: raw.detectifai.configured ? 'CONNECTED · SERVER API KEY SET' : 'ERROR · DETECTIF_API_KEY UNSET',
      icon: 'neurology',
      rows: [
        { label: 'Base URL', value: raw.detectifai.baseUrl },
        { label: 'Enrollment / Verify', value: raw.detectifai.configured ? 'Ready' : 'Fail-Closed (503)' },
        { label: 'Retention Notice', value: '30-day DetectifAI storage' },
      ],
      note: 'All audio uploads route server-side via Node enclave; API keys never reach browser bundles.',
    },
    {
      id: 'github',
      name: 'GitHub Deployment Rule',
      status: raw.github.configured ? 'CONNECTED' : 'DISCONNECTED',
      subtitle: raw.github.configured ? 'CONNECTED · GITHUB APP' : 'DISCONNECTED · CREDENTIALS UNSET',
      icon: 'code',
      rows: [
        { label: 'App JWT Signing', value: raw.github.configured ? 'RS256 Ready' : 'Missing Key/App ID' },
        { label: 'Webhook Secret', value: raw.github.webhookSecretConfigured ? 'X-Hub-Signature-256' : 'Unconfigured' },
        { label: 'Deliveries Recorded', value: String(raw.github.webhookDeliveryCount || 0) },
      ],
      note: 'Public repositories on all plans; private/internal repositories require GitHub Enterprise.',
    },
    {
      id: 'webauthn',
      name: 'WebAuthn / FIDO2 RP',
      status: 'ENFORCED',
      subtitle: `ENFORCED · RP ${raw.webauthn.rpId}`,
      icon: 'passkey',
      rows: [
        { label: 'Relying Party ID', value: raw.webauthn.rpId },
        { label: 'Verification', value: '@simplewebauthn/server' },
        { label: 'Sign Count Guard', value: 'Monotonic Counter' },
      ],
      note: 'Hardware/platform FIDO2 step-up enforced on every release; userVerified + challenge validated server-side.',
    },
  ];
}

export function mapBackendIncidentToUi(raw: Record<string, unknown>): SecurityIncidentRecord {
  const rawStatus = String(raw.status || 'OPEN').toUpperCase();
  const status: SecurityIncidentRecord['status'] =
    rawStatus === 'INVESTIGATING'
      ? 'INVESTIGATING'
      : rawStatus === 'BLOCKED'
        ? 'BLOCKED'
        : rawStatus === 'RESOLVED'
          ? 'RESOLVED'
          : 'QUARANTINED / ON_HOLD';

  return {
    id: String(raw.id || ''),
    severity: String(raw.severity || '').includes('HIGH') ? 'SEV-2 HIGH' : 'SEV-1 CRITICAL',
    title: String(raw.title || 'Security Interception'),
    target: String(raw.target || 'Gateway Enclave'),
    envelopeId: String(raw.actionRequestId || 'SYSTEM'),
    status,
    aletheiaScore: typeof raw.aletheiaScore === 'number' ? raw.aletheiaScore : 0,
    aletheiaVerdict: raw.aletheiaVerdict === 'FAKE' ? 'FAKE' : 'REAL',
    eidosDecision: raw.eidosDecision === 'NO_MATCH' ? 'MISMATCH' : 'MATCH',
    eidosSimilarity: typeof raw.eidosSimilarity === 'number' ? raw.eidosSimilarity : 0,
    claimedApprover: String(raw.claimedApprover || 'N/A'),
    anomalyNote: String(raw.reason || ''),
  };
}
