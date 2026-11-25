import { computeEnvelopeHash } from '../crypto.mjs';
import { ConflictError, NotFoundError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';

export const ACTION_STATES = Object.freeze({
  PENDING: 'PENDING',
  CHALLENGE_ISSUED: 'CHALLENGE_ISSUED',
  VOICE_CHECK_PENDING: 'VOICE_CHECK_PENDING',
  VOICE_VERIFIED: 'VOICE_VERIFIED',
  HOLD: 'HOLD',
  BLOCKED: 'BLOCKED',
  WAITING_FOR_PASSKEY: 'WAITING_FOR_PASSKEY',
  WAITING_FOR_PEER_APPROVAL: 'WAITING_FOR_PEER_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED',
  TOKEN_ISSUED: 'TOKEN_ISSUED',
  CONSUMED: 'CONSUMED',
});

/**
 * Single authoritative state-transition table.
 * Notice VOICE_VERIFIED can NEVER jump directly to APPROVED or TOKEN_ISSUED without policy/passkey/peer checks.
 */
export const ALLOWED_TRANSITIONS = new Map([
  ['PENDING', new Set(['CHALLENGE_ISSUED', 'HOLD', 'BLOCKED', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['CHALLENGE_ISSUED', new Set(['VOICE_CHECK_PENDING', 'CHALLENGE_ISSUED', 'HOLD', 'BLOCKED', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['VOICE_CHECK_PENDING', new Set(['VOICE_VERIFIED', 'HOLD', 'BLOCKED', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['VOICE_VERIFIED', new Set(['WAITING_FOR_PASSKEY', 'WAITING_FOR_PEER_APPROVAL', 'HOLD', 'BLOCKED', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['WAITING_FOR_PASSKEY', new Set(['WAITING_FOR_PEER_APPROVAL', 'APPROVED', 'HOLD', 'BLOCKED', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['WAITING_FOR_PEER_APPROVAL', new Set(['APPROVED', 'HOLD', 'BLOCKED', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['HOLD', new Set(['CHALLENGE_ISSUED', 'VOICE_CHECK_PENDING', 'VOICE_VERIFIED', 'WAITING_FOR_PASSKEY', 'WAITING_FOR_PEER_APPROVAL', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'BLOCKED'])],
  ['INVALIDATED', new Set(['CHALLENGE_ISSUED', 'HOLD', 'REJECTED', 'EXPIRED', 'BLOCKED'])],
  ['APPROVED', new Set(['TOKEN_ISSUED', 'HOLD', 'REJECTED', 'EXPIRED', 'INVALIDATED'])],
  ['TOKEN_ISSUED', new Set(['CONSUMED', 'EXPIRED', 'INVALIDATED', 'REJECTED'])],
  ['BLOCKED', new Set(['REJECTED', 'HOLD'])],
  ['REJECTED', new Set()],
  ['EXPIRED', new Set()],
  ['CONSUMED', new Set()],
]);

const TERMINAL_STATES = new Set(['REJECTED', 'EXPIRED', 'CONSUMED']);

export function verifyLatestEnvelopeIntegrity(db, actionRequestId, expectedActionHash = null) {
  const action = db.prepare('SELECT * FROM action_requests WHERE id = ?').get(actionRequestId);
  if (!action) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }
  const envelope = db
    .prepare('SELECT * FROM action_envelopes WHERE action_request_id = ? AND version = ?')
    .get(actionRequestId, action.current_version);
  if (!envelope) {
    throw new ConflictError(`Missing canonical envelope for version ${action.current_version}`);
  }

  const parsed = JSON.parse(envelope.canonical_json);
  const recomputed = computeEnvelopeHash(parsed);
  if (recomputed !== envelope.action_hash) {
    return { valid: false, reason: 'STORED_ENVELOPE_DIGEST_MISMATCH', action, envelope, recomputed };
  }
  if (expectedActionHash && expectedActionHash !== envelope.action_hash) {
    return { valid: false, reason: 'EXPECTED_ACTION_HASH_MISMATCH', action, envelope, recomputed };
  }
  return { valid: true, action, envelope, recomputed };
}

export function transitionActionState({
  db,
  actionRequestId,
  toState,
  actorUserId = null,
  reason = '',
  metadata = {},
  expectedActionHash = null,
  skipIntegrityCheck = false,
}) {
  if (!Object.values(ACTION_STATES).includes(toState)) {
    throw new ConflictError(`Unknown target state: ${toState}`);
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const action = db.prepare('SELECT * FROM action_requests WHERE id = ?').get(actionRequestId);
    if (!action) {
      throw new NotFoundError(`Action request ${actionRequestId} not found`);
    }

    const nowIso = new Date().toISOString();
    const isExpired = new Date(action.expires_at).getTime() <= Date.now();
    if (isExpired && !TERMINAL_STATES.has(action.current_state) && toState !== ACTION_STATES.EXPIRED && toState !== ACTION_STATES.REJECTED) {
      db.prepare('UPDATE action_requests SET current_state = ?, updated_at = ? WHERE id = ?').run(
        ACTION_STATES.EXPIRED,
        nowIso,
        actionRequestId,
      );
      recordAuditEvent({
        db,
        organisationId: action.organisation_id,
        actionRequestId,
        actorUserId,
        eventType: 'ACTION_EXPIRED',
        payload: { previousState: action.current_state, expiresAt: action.expires_at },
      });
      db.exec('COMMIT;');
      throw new ConflictError(`Action request ${actionRequestId} has expired`);
    }

    if (!skipIntegrityCheck && toState !== ACTION_STATES.HOLD && toState !== ACTION_STATES.INVALIDATED && toState !== ACTION_STATES.REJECTED) {
      const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId, expectedActionHash);
      if (!integrity.valid) {
        db.prepare('UPDATE action_requests SET current_state = ?, updated_at = ? WHERE id = ?').run(
          ACTION_STATES.HOLD,
          nowIso,
          actionRequestId,
        );
        recordAuditEvent({
          db,
          organisationId: action.organisation_id,
          actionRequestId,
          actorUserId,
          eventType: 'ENVELOPE_INTEGRITY_HOLD',
          payload: { reason: integrity.reason, expectedActionHash, actualHash: integrity.envelope.action_hash },
        });
        db.exec('COMMIT;');
        throw new ConflictError(`Envelope hash check failed (${integrity.reason}); action placed on HOLD`);
      }
    }

    const allowed = ALLOWED_TRANSITIONS.get(action.current_state);
    if (!allowed || !allowed.has(toState)) {
      throw new ConflictError(`Invalid state transition from ${action.current_state} to ${toState}`);
    }

    db.prepare('UPDATE action_requests SET current_state = ?, updated_at = ? WHERE id = ?').run(
      toState,
      nowIso,
      actionRequestId,
    );

    const audit = recordAuditEvent({
      db,
      organisationId: action.organisation_id,
      actionRequestId,
      actorUserId,
      eventType: `STATE_${toState}`,
      payload: {
        fromState: action.current_state,
        toState,
        version: action.current_version,
        reason,
        ...metadata,
      },
    });

    db.exec('COMMIT;');
    return {
      actionRequestId,
      fromState: action.current_state,
      toState,
      version: action.current_version,
      updatedAt: nowIso,
      auditEventId: audit.id,
    };
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // already committed before throwing ConflictError on expiry/integrity hold
    }
    throw err;
  }
}
