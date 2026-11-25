export type AppMode = 'demo' | 'live';

export type ActionPolicyState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AWAITING_APPROVER'
  | 'CHALLENGE_ISSUED'
  | 'RECORDING'
  | 'VERIFICATION_PENDING'
  | 'VOICE_STAGE_PASSED'
  | 'STEP_UP_PENDING'
  | 'PEER_APPROVAL_PENDING'
  | 'AUTHORIZED'
  | 'ON_HOLD'
  | 'REJECTED'
  | 'EXPIRED'
  | 'ACTION_CHANGED'
  | 'INTEGRATION_ERROR'
  | 'MANUAL_REVIEW';

export type ActionCategory = 'DevSecOps' | 'Financial' | 'IAM' | 'Break-Glass';
export type RiskTier = 'CRITICAL' | 'HIGH' | 'ELEVATED';

export interface GitHubActionDetails {
  kind: 'github';
  repository: string;
  commitSha: string;
  branch: string;
  workflowRunId: string;
  workflowFile: string;
  targetEnvironment: string;
  customRuleId?: string;
  dockerDigest?: string;
  maxRolloutConcurrency?: string;
  autoRollbackWindow?: string;
  deploymentStatus?: 'waiting' | 'approved' | 'rejected' | 'error';
  prRef?: string;
}

export interface FinanceActionDetails {
  kind: 'finance';
  vendor: string;
  originalVendor?: string;
  depositoryBank: string;
  originalDepositoryBank?: string;
  beneficiaryReference: string;
  originalBeneficiaryReference?: string;
  invoiceReference: string;
  amount: string;
  currency: string;
  purpose: string;
  paymentRequestId: string;
  egressGate: string;
  riskScore?: number;
  sanctionsNote?: string;
}

export interface IamActionDetails {
  kind: 'iam';
  targetSystem: string;
  privilegeScope: string;
  ttlHours: number;
  targetAccount: string;
}

export type ActionPayloadDetails = GitHubActionDetails | FinanceActionDetails | IamActionDetails;

export interface AletheiaSegment {
  start: number;
  end: number;
  score: number;
}

export interface AletheiaResult {
  status: 'idle' | 'processing' | 'completed' | 'partial' | 'error';
  verdict: 'real' | 'fake' | null;
  score: number | null;
  durationSeconds: number | null;
  segments: AletheiaSegment[];
  operationId: string | null;
  modelContract?: string;
  threshold?: number;
  errorMessage?: string;
}

export interface EidosResult {
  status: 'idle' | 'processing' | 'completed' | 'partial' | 'error';
  decision: 'match' | 'no_match' | null;
  /** Similarity metric in range -1 to 1. Never render as a percentage. */
  similarity: number | null;
  speakerId: string;
  durationSeconds: number | null;
  operationId: string | null;
  modelContract?: string;
  consentTimestamp?: string;
  errorMessage?: string;
}

export interface VoiceChallenge {
  nonceId: string;
  phrase: string;
  issuedAt: string;
  expiresAt: string;
  remainingSeconds: number;
  sttValidated: boolean;
  sttMatchScore?: number;
  recordingDurationSec?: number;
  waveformBars: number[];
}

export interface PasskeyAssertionState {
  status:
    | 'not_requested'
    | 'requested'
    | 'prompting'
    | 'verification_pending'
    | 'verified'
    | 'failed'
    | 'expired';
  credentialId?: string;
  rpId: string;
  challenge?: string;
  aaguid?: string;
  deviceLabel?: string;
  signatureCounter?: number;
  userPresent?: boolean;
  userVerified?: boolean;
  attestedAt?: string;
  errorMessage?: string;
}

export interface QuorumSigner {
  id: string;
  name: string;
  initials: string;
  role: string;
  voiceStatus: 'VOICE_VERIFIED' | 'VOICE_PENDING' | 'VOICE_FAILED';
  passkeyStatus: 'VERIFIED' | 'AWAITING_TOUCH' | 'PENDING' | 'FAILED';
  timestamp?: string;
  credentialId?: string;
  isCurrentUser?: boolean;
}

export interface ActionEnvelope {
  id: string;
  actionId: string;
  orgId: string;
  category: ActionCategory;
  targetTitle: string;
  targetSubtitle: string;
  requester: string;
  requesterInitials: string;
  requesterRole: string;
  claimedApprover: string;
  claimedApproverInitials: string;
  claimedApproverRole: string;
  riskTier: RiskTier;
  state: ActionPolicyState;
  version: string;
  createdAt: string;
  expiresAt: string;
  ageDisplay: string;
  actionHash: string;
  ingressHash?: string;
  hashDriftDetected?: boolean;
  singleUseJti: string;
  jtiConsumed: boolean;
  policyId: string;
  policySummary: string;
  details: ActionPayloadDetails;
  challenge: VoiceChallenge;
  aletheia: AletheiaResult;
  eidos: EidosResult;
  passkey: PasskeyAssertionState;
  quorumSigners: QuorumSigner[];
  peerApprovalSatisfied: boolean;
  rbacSatisfied: boolean;
  auditEvents: Array<{
    timestamp: string;
    eventId: string;
    title: string;
    detail: string;
    badge: string;
    tone: 'success' | 'warning' | 'error' | 'neutral' | 'teal';
  }>;
}

export interface EnrolledSpeaker {
  id: string;
  name: string;
  initials: string;
  role: string;
  department: 'SecOps' | 'Treasury' | 'DevOps/SRE';
  email: string;
  speakerId: string;
  vectorHash: string;
  durationSec: number;
  sampleCount: number;
  snrDb: number;
  snrLabel: string;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'REVOKED' | 'PENDING_RECONSENT';
  consentExpiryDays: number;
  signedAt: string;
  ed25519Signature: string;
  scopes: string[];
  livenessHistory: Array<'pass' | 'warn' | 'fail'>;
  hasAvatar?: boolean;
}

export interface SecurityPolicyRule {
  id: string;
  name: string;
  category: ActionCategory | 'IT Identity';
  target: string;
  riskTier: RiskTier;
  voiceCheck: string;
  fido2: 'Mandatory' | 'Optional';
  quorum: string;
  nonceTtlSec: number;
  permitTtlSec: number;
  sodRule: string;
  voiceRequirements: string;
  fallbackPath: string;
  status: 'ACTIVE' | 'DRAFT';
}

export interface IntegrationAdapter {
  id: string;
  name: string;
  status: 'CONNECTED' | 'ENFORCED' | 'SANDBOX' | 'DISCONNECTED' | 'ERROR';
  subtitle: string;
  rows: Array<{ label: string; value: string }>;
  note: string;
  icon: string;
}

export interface WebhookEventRecord {
  eventId: string;
  eventType: string;
  relatedActionId: string;
  source: string;
  status: 'PROCESSED' | 'RETRYING' | 'FAILED';
  hmacStatus: 'VERIFIED' | 'INVALID' | 'PENDING';
  timestampSkew: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface AuditEventRecord {
  timestamp: string;
  eventId: string;
  envelopeId: string;
  eventType: string;
  tone: 'teal' | 'info' | 'error' | 'neutral';
  previousHash: string;
  currentHash: string;
  blockNumber: number;
  payload: Record<string, unknown>;
}

export interface SecurityIncidentRecord {
  id: string;
  severity: 'SEV-1 CRITICAL' | 'SEV-2 HIGH';
  title: string;
  target: string;
  envelopeId: string;
  status: 'QUARANTINED / ON_HOLD' | 'INVESTIGATING' | 'BLOCKED' | 'RESOLVED';
  aletheiaScore: number;
  aletheiaVerdict: 'FAKE' | 'REAL';
  eidosDecision: 'MISMATCH' | 'MATCH';
  eidosSimilarity: number;
  claimedApprover: string;
  anomalyNote: string;
}

export const AI_EVIDENCE_DISCLAIMER =
  'AI verification provides additional security evidence. It does not independently prove identity, authority or intent.';
