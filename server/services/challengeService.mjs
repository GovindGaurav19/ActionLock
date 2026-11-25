import crypto from 'node:crypto';
import { ForbiddenError, NotFoundError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { ACTION_STATES, transitionActionState, verifyLatestEnvelopeIntegrity } from './stateMachine.mjs';

const CHALLENGE_WORDS = [
  'amber',
  'beacon',
  'cedar',
  'delta',
  'ember',
  'falcon',
  'granite',
  'harbor',
  'indigo',
  'jasper',
  'kestrel',
  'lumen',
  'meridian',
  'north',
  'obsidian',
  'prism',
  'quartz',
  'ridge',
  'summit',
  'timber',
  'vector',
  'willow',
  'zenith',
];

function pickRandomWords(count = 3) {
  const words = [];
  for (let i = 0; i < count; i++) {
    words.push(CHALLENGE_WORDS[crypto.randomInt(0, CHALLENGE_WORDS.length)]);
  }
  return words;
}

function buildActionSummary(action, envelopePayload) {
  const p = envelopePayload.parameters || {};
  if (action.category === 'GITHUB_DEPLOYMENT') {
    return `deploy ${p.repositoryOwner}/${p.repositoryName} commit ${String(p.commitSha).slice(0, 7)} to ${p.targetEnvironment}`;
  }
  if (action.category === 'FINANCE_APPROVAL') {
    return `approve ${p.currency} ${p.amount} payment to ${p.vendorReference}`;
  }
  return `authorize ${action.target_system} in ${action.environment}`;
}

export function issueVoiceChallenge({ db, authCtx, actionRequestId, ttlSeconds = 180 }) {
  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);

  if (!action) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }
  if (action.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Separation of duties violation: requester cannot generate/complete own voice challenge');
  }

  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId);
  if (!integrity.valid) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `Cannot issue challenge: ${integrity.reason}`,
      skipIntegrityCheck: true,
    });
  }

  const payload = JSON.parse(integrity.envelope.canonical_json);
  const nonceBytes = crypto.randomBytes(4).toString('hex').toUpperCase();
  const nonce = `${nonceBytes.slice(0, 4)}-${nonceBytes.slice(4, 8)}`;
  const words = pickRandomWords(3);
  const summary = buildActionSummary(action, payload);
  const phrase = `ActionLock ${action.id}: I ${authCtx.user.displayName} confirm to ${summary}. Challenge words ${words.join(' ')} code ${nonce}.`;

  const challengeId = `vch_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const effectiveTtl = Math.min(Math.max(Number(ttlSeconds || 180), 60), 600);
  const expiresAt = new Date(now.getTime() + effectiveTtl * 1000).toISOString();

  // Expire any previous unused challenges for this action
  db.prepare('UPDATE voice_challenges SET consumed_at = ? WHERE action_request_id = ? AND consumed_at IS NULL').run(
    nowIso,
    actionRequestId,
  );

  db.prepare(
    `INSERT INTO voice_challenges
      (id, action_request_id, action_hash, nonce, phrase, designated_approver_id, stt_status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
  ).run(
    challengeId,
    actionRequestId,
    integrity.envelope.action_hash,
    nonce,
    phrase,
    action.claimed_approver_user_id || authCtx.user.id,
    expiresAt,
    nowIso,
  );

  transitionActionState({
    db,
    actionRequestId,
    toState: ACTION_STATES.CHALLENGE_ISSUED,
    actorUserId: authCtx.user.id,
    reason: 'Fresh voice challenge issued',
    metadata: { challengeId, nonce, challengeWords: words },
    expectedActionHash: integrity.envelope.action_hash,
  });

  recordAuditEvent({
    db,
    organisationId: authCtx.organisation.id,
    actionRequestId,
    actorUserId: authCtx.user.id,
    eventType: 'VOICE_CHALLENGE_ISSUED',
    payload: { challengeId, nonce, actionHash: integrity.envelope.action_hash, expiresAt },
  });

  return {
    id: challengeId,
    actionRequestId,
    actionHash: integrity.envelope.action_hash,
    nonce,
    challengeWords: words,
    phrase,
    designatedApproverId: action.claimed_approver_user_id || authCtx.user.id,
    expiresAt,
    createdAt: nowIso,
  };
}
