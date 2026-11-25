import crypto from 'node:crypto';
import { NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { verifyLatestEnvelopeIntegrity } from './stateMachine.mjs';

export function listPolicies(db, organisationId) {
  return db
    .prepare('SELECT * FROM approval_policies WHERE organisation_id = ? ORDER BY id ASC')
    .all(organisationId)
    .map((p) => ({
      id: p.id,
      organisationId: p.organisation_id,
      name: p.name,
      category: p.category,
      target: p.target,
      riskTier: p.risk_tier,
      requireVoice: Boolean(p.require_voice),
      requirePasskey: Boolean(p.require_passkey),
      requirePeerApproval: Boolean(p.require_peer_approval),
      nonceTtlSec: p.nonce_ttl_sec,
      permitTtlSec: p.permit_ttl_sec,
      rules: JSON.parse(p.rules_json),
      status: p.status,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
}

function validatePolicyPayload(input) {
  const name = String(input.name || '').trim();
  const category = String(input.category || '').trim();
  const target = String(input.target || '').trim();
  const riskTier = String(input.riskTier || 'CRITICAL').trim();
  if (!name || !category || !target) {
    throw new ValidationError('Policy name, category, and target are required');
  }
  if (!['CRITICAL', 'HIGH', 'ELEVATED'].includes(riskTier)) {
    throw new ValidationError('riskTier must be CRITICAL, HIGH, or ELEVATED');
  }
  const nonceTtlSec = Math.min(Math.max(Number(input.nonceTtlSec || 180), 30), 900);
  const permitTtlSec = Math.min(Math.max(Number(input.permitTtlSec || 300), 30), 1800);
  return {
    name,
    category,
    target,
    riskTier,
    requireVoice: input.requireVoice !== false ? 1 : 0,
    requirePasskey: input.requirePasskey !== false ? 1 : 0,
    requirePeerApproval: input.requirePeerApproval !== false ? 1 : 0,
    nonceTtlSec,
    permitTtlSec,
    rules: {
      sodRule: String(input.sodRule || 'Requester != Approver != Peer Signer'),
      voiceRequirements: String(input.voiceRequirements || 'Eidos match + Aletheia real (evidence only)'),
      fallbackPath: String(input.fallbackPath || 'Out-of-band SecOps callback + ticket'),
    },
  };
}

export function createPolicy({ db, authCtx, input }) {
  const id = String(input.id || `POL-${crypto.randomBytes(2).toString('hex').toUpperCase()}`).trim();
  const v = validatePolicyPayload(input);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO approval_policies
      (id, organisation_id, name, category, target, risk_tier, require_voice, require_passkey, require_peer_approval, nonce_ttl_sec, permit_ttl_sec, rules_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  ).run(
    id,
    authCtx.organisation.id,
    v.name,
    v.category,
    v.target,
    v.riskTier,
    v.requireVoice,
    v.requirePasskey,
    v.requirePeerApproval,
    v.nonceTtlSec,
    v.permitTtlSec,
    JSON.stringify(v.rules),
    now,
    now,
  );
  recordAuditEvent({
    db,
    organisationId: authCtx.organisation.id,
    actorUserId: authCtx.user.id,
    eventType: 'POLICY_CREATED',
    payload: { policyId: id, ...v },
  });
  return listPolicies(db, authCtx.organisation.id).find((p) => p.id === id);
}

export function updatePolicy({ db, authCtx, policyId, input }) {
  const existing = db
    .prepare('SELECT * FROM approval_policies WHERE id = ? AND organisation_id = ?')
    .get(policyId, authCtx.organisation.id);
  if (!existing) throw new NotFoundError(`Policy ${policyId} not found`);

  const merged = {
    name: input.name ?? existing.name,
    category: input.category ?? existing.category,
    target: input.target ?? existing.target,
    riskTier: input.riskTier ?? existing.risk_tier,
    requireVoice: input.requireVoice !== undefined ? input.requireVoice : Boolean(existing.require_voice),
    requirePasskey: input.requirePasskey !== undefined ? input.requirePasskey : Boolean(existing.require_passkey),
    requirePeerApproval:
      input.requirePeerApproval !== undefined ? input.requirePeerApproval : Boolean(existing.require_peer_approval),
    nonceTtlSec: input.nonceTtlSec ?? existing.nonce_ttl_sec,
    permitTtlSec: input.permitTtlSec ?? existing.permit_ttl_sec,
    ...JSON.parse(existing.rules_json),
    ...(input.rules || {}),
  };
  const v = validatePolicyPayload(merged);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE approval_policies
     SET name = ?, category = ?, target = ?, risk_tier = ?, require_voice = ?, require_passkey = ?, require_peer_approval = ?, nonce_ttl_sec = ?, permit_ttl_sec = ?, rules_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    v.name,
    v.category,
    v.target,
    v.riskTier,
    v.requireVoice,
    v.requirePasskey,
    v.requirePeerApproval,
    v.nonceTtlSec,
    v.permitTtlSec,
    JSON.stringify(v.rules),
    now,
    policyId,
  );
  recordAuditEvent({
    db,
    organisationId: authCtx.organisation.id,
    actorUserId: authCtx.user.id,
    eventType: 'POLICY_UPDATED',
    payload: { policyId, ...v },
  });
  return listPolicies(db, authCtx.organisation.id).find((p) => p.id === policyId);
}

export function findMatchingPolicy(db, organisationId, category) {
  const exact = db
    .prepare("SELECT * FROM approval_policies WHERE organisation_id = ? AND category = ? AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1")
    .get(organisationId, category);
  if (exact) return exact;
  return db
    .prepare("SELECT * FROM approval_policies WHERE organisation_id = ? AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1")
    .get(organisationId);
}

/**
 * Pure deterministic policy evaluator. Never uses AI/LLM for authorization decisions.
 */
export function evaluateActionPolicy({ db, actionRequestId, actingUser = null }) {
  const action = db.prepare('SELECT * FROM action_requests WHERE id = ?').get(actionRequestId);
  if (!action) throw new NotFoundError(`Action request ${actionRequestId} not found`);

  const policy = findMatchingPolicy(db, action.organisation_id, action.category);
  const missingFactors = [];
  const blockingReasons = [];

  const notExpired = new Date(action.expires_at).getTime() > Date.now();
  if (!notExpired) blockingReasons.push('ACTION_EXPIRED');

  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId);
  if (!integrity.valid) blockingReasons.push(integrity.reason);

  const currentHash = integrity.envelope.action_hash;

  // Separation of duties & RBAC
  let sodValid = action.requester_user_id !== action.claimed_approver_user_id;
  let roleValid = true;
  if (actingUser) {
    if (actingUser.id === action.requester_user_id) {
      sodValid = false;
      blockingReasons.push('SELF_APPROVAL_FORBIDDEN');
    }
    if (!actingUser.permissions?.includes('action:approve')) {
      roleValid = false;
      blockingReasons.push('INVALID_APPROVER_ROLE');
    }
  }

  // Voice evidence check
  let voicePassed = true;
  if (!policy || policy.require_voice) {
    const verification = db
      .prepare('SELECT * FROM voice_verifications WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(actionRequestId);
    const challenge = verification
      ? db.prepare('SELECT * FROM voice_challenges WHERE id = ?').get(verification.challenge_id)
      : null;

    voicePassed = Boolean(
      verification &&
        challenge &&
        challenge.action_hash === currentHash &&
        challenge.stt_status === 'MATCHED' &&
        verification.evidence_status === 'DUAL_VERIFIED' &&
        verification.eidos_decision === 'match' &&
        verification.aletheia_verdict === 'real',
    );
    if (!voicePassed) {
      missingFactors.push('VOICE_VERIFICATION');
      if (verification?.aletheia_verdict === 'fake') blockingReasons.push('ALETHEIA_FAKE');
      if (verification?.eidos_decision === 'no_match') blockingReasons.push('EIDOS_NO_MATCH');
      if (verification?.evidence_status === 'PARTIAL') blockingReasons.push('PARTIAL_AI_RESULT');
    }
  }

  // Server-verified WebAuthn passkey check bound to current action_hash
  let passkeyPassed = true;
  const passkeyApproval = db
    .prepare(
      `SELECT * FROM approvals
       WHERE action_request_id = ? AND approval_kind = 'PASSKEY' AND decision = 'APPROVED' AND action_hash = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(actionRequestId, currentHash);
  if (!policy || policy.require_passkey) {
    passkeyPassed = Boolean(passkeyApproval);
    if (!passkeyPassed) missingFactors.push('PASSKEY_VERIFICATION');
  }

  // Independent peer approval check bound to current action_hash (must differ from requester and passkey signer)
  let peerPassed = true;
  const peerApproval = db
    .prepare(
      `SELECT * FROM approvals
       WHERE action_request_id = ? AND approval_kind = 'PEER' AND decision = 'APPROVED' AND action_hash = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(actionRequestId, currentHash);
  if (!policy || policy.require_peer_approval) {
    peerPassed = Boolean(
      peerApproval &&
        peerApproval.approver_user_id !== action.requester_user_id &&
        (!passkeyApproval || peerApproval.approver_user_id !== passkeyApproval.approver_user_id),
    );
    if (!peerPassed) missingFactors.push('PEER_APPROVAL');
  }

  let decision = 'ALLOW_RELEASE';
  if (blockingReasons.length > 0) {
    decision = blockingReasons.some((r) => ['SELF_APPROVAL_FORBIDDEN', 'INVALID_APPROVER_ROLE'].includes(r))
      ? 'BLOCK'
      : 'HOLD';
  } else if (missingFactors.length > 0) {
    decision = 'HOLD';
  }

  return {
    decision,
    policyId: policy?.id || 'DEFAULT_STRICT',
    actionHash: currentHash,
    checks: {
      notExpired,
      hashIntact: integrity.valid,
      sodValid,
      roleValid,
      voicePassed,
      passkeyPassed,
      peerPassed,
    },
    missingFactors,
    blockingReasons,
  };
}
