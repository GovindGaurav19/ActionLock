import crypto from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { evaluateActionPolicy } from './policyEngineService.mjs';
import { ACTION_STATES, transitionActionState, verifyLatestEnvelopeIntegrity } from './stateMachine.mjs';

function signPermitJwt({ payload, secret }) {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'ACTIONLOCK-PERMIT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sigB64}`;
}

function verifyPermitJwt({ rawToken, secret }) {
  const parts = String(rawToken || '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'MALFORMED_TOKEN' };
  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'INVALID_TOKEN_SIGNATURE' };
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'INVALID_TOKEN_PAYLOAD' };
  }
}

export function recordPeerApproval({ db, authCtx, actionRequestId, decision = 'APPROVED', reason = '' }) {
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new ValidationError('decision must be APPROVED or REJECTED');
  }

  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!action) throw new NotFoundError(`Action request ${actionRequestId} not found`);

  if (action.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Separation of duties violation: requester cannot peer-approve own action');
  }

  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId);
  if (!integrity.valid) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `Hash check failed during peer approval (${integrity.reason})`,
      skipIntegrityCheck: true,
    });
    throw new ConflictError('Action envelope modified; prior verification invalidated');
  }

  const actionHash = integrity.envelope.action_hash;

  // Prevent duplicate peer approval or self-co-sign by the same passkey signer
  const existingPeer = db
    .prepare(
      `SELECT id FROM approvals WHERE action_request_id = ? AND approval_kind = 'PEER' AND approver_user_id = ? AND action_hash = ?`,
    )
    .get(actionRequestId, authCtx.user.id, actionHash);
  if (existingPeer) {
    throw new ConflictError('Duplicate peer approval from the same user for this action version');
  }

  const passkeySigner = db
    .prepare(
      `SELECT approver_user_id FROM approvals WHERE action_request_id = ? AND approval_kind = 'PASSKEY' AND decision = 'APPROVED' AND action_hash = ? LIMIT 1`,
    )
    .get(actionRequestId, actionHash);
  if (passkeySigner && passkeySigner.approver_user_id === authCtx.user.id) {
    throw new ForbiddenError('Peer approval must come from an independent approver distinct from the primary passkey signer');
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO approvals (id, action_request_id, approver_user_id, approval_kind, decision, action_hash, reason, created_at)
     VALUES (?, ?, ?, 'PEER', ?, ?, ?, ?)`,
  ).run(`apr_${crypto.randomBytes(6).toString('hex')}`, actionRequestId, authCtx.user.id, decision, actionHash, reason, now);

  if (decision === 'REJECTED') {
    const tr = transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.REJECTED,
      actorUserId: authCtx.user.id,
      reason: reason || 'Rejected at peer approval stage',
      skipIntegrityCheck: true,
    });
    return { state: tr.toState, decision: 'REJECTED' };
  }

  const policyEval = evaluateActionPolicy({ db, actionRequestId, actingUser: authCtx.user });
  if (policyEval.decision !== 'ALLOW_RELEASE') {
    throw new ConflictError(
      `Cannot approve action: policy returned ${policyEval.decision} (missing: ${policyEval.missingFactors.join(', ')})`,
    );
  }

  const tr = transitionActionState({
    db,
    actionRequestId,
    toState: ACTION_STATES.APPROVED,
    actorUserId: authCtx.user.id,
    reason: reason || 'Independent peer approval recorded and all policy checks satisfied',
    expectedActionHash: actionHash,
  });

  return { state: tr.toState, decision: 'APPROVED', policyEvaluation: policyEval };
}

export function issueScopedPermitToken({ db, config, authCtx, actionRequestId }) {
  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!action) throw new NotFoundError(`Action request ${actionRequestId} not found`);

  const policyEval = evaluateActionPolicy({ db, actionRequestId, actingUser: authCtx.user });
  if (policyEval.decision !== 'ALLOW_RELEASE') {
    throw new ForbiddenError(
      `Cannot issue permit token: policy evaluation is ${policyEval.decision} (${[...policyEval.blockingReasons, ...policyEval.missingFactors].join(', ')})`,
    );
  }

  // Prevent issuing a second token for the same completed authorization
  const existingToken = db
    .prepare('SELECT jti FROM authorization_tokens WHERE action_request_id = ? AND action_hash = ?')
    .get(actionRequestId, policyEval.actionHash);
  if (existingToken) {
    throw new ConflictError(`Scoped token ${existingToken.jti} already issued for this authorization`);
  }

  const jti = `jti_${crypto.randomBytes(8).toString('hex')}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = 180;
  const expSec = nowSec + ttlSec;
  const expiresAt = new Date(expSec * 1000).toISOString();
  const scope = `${action.category}:${action.id}`;

  const payload = {
    iss: 'actionlock-policy-engine',
    sub: authCtx.user.id,
    jti,
    action_id: action.id,
    organisation_id: action.organisation_id,
    action_hash: policyEval.actionHash,
    scope,
    target_integration: action.source_integration,
    environment: action.environment,
    iat: nowSec,
    exp: expSec,
  };

  const token = signPermitJwt({ payload, secret: config.actionTokenSecret });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO authorization_tokens
      (id, jti, action_request_id, organisation_id, action_hash, scope, target_integration, environment, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `tok_${crypto.randomBytes(6).toString('hex')}`,
    jti,
    action.id,
    action.organisation_id,
    policyEval.actionHash,
    scope,
    action.source_integration,
    action.environment,
    tokenHash,
    expiresAt,
    nowIso,
  );

  transitionActionState({
    db,
    actionRequestId,
    toState: ACTION_STATES.TOKEN_ISSUED,
    actorUserId: authCtx.user.id,
    reason: 'Single-use scoped authorization token minted',
    metadata: { jti, scope, expiresAt },
    expectedActionHash: policyEval.actionHash,
  });

  return { jti, token, scope, targetIntegration: action.source_integration, environment: action.environment, actionHash: policyEval.actionHash, expiresAt };
}

export function consumeScopedPermitToken({
  db,
  config,
  rawToken,
  expectedActionId,
  expectedScope = null,
  expectedTargetIntegration = null,
  expectedEnvironment = null,
}) {
  const verified = verifyPermitJwt({ rawToken, secret: config.actionTokenSecret });
  if (!verified.valid) {
    throw new ForbiddenError(`Token rejected: ${verified.reason}`);
  }
  const claims = verified.payload;
  if (!claims.exp || claims.exp * 1000 <= Date.now()) {
    throw new ConflictError('Authorization token has expired');
  }
  if (expectedActionId && claims.action_id !== expectedActionId) {
    throw new ForbiddenError('Token action_id mismatch');
  }
  if (expectedScope && claims.scope !== expectedScope) {
    throw new ForbiddenError('Token scope mismatch');
  }
  if (expectedTargetIntegration && claims.target_integration !== expectedTargetIntegration) {
    throw new ForbiddenError('Token target integration mismatch');
  }
  if (expectedEnvironment && claims.environment !== expectedEnvironment) {
    throw new ForbiddenError('Token environment mismatch');
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Recompute latest canonical action hash before consuming
  const integrity = verifyLatestEnvelopeIntegrity(db, claims.action_id, claims.action_hash);
  if (!integrity.valid) {
    throw new ConflictError(`Token rejected: action envelope changed (${integrity.reason})`);
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE;');
  try {
    const row = db
      .prepare('SELECT * FROM authorization_tokens WHERE jti = ? AND token_hash = ?')
      .get(claims.jti, tokenHash);
    if (!row) {
      throw new ForbiddenError('Authorization token record not found');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new ConflictError('Authorization token has expired');
    }
    if (row.consumed_at) {
      throw new ConflictError('Authorization token has already been consumed');
    }

    const res = db
      .prepare('UPDATE authorization_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(nowIso, row.id);
    if (res.changes !== 1) {
      throw new ConflictError('Authorization token already consumed concurrently');
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  transitionActionState({
    db,
    actionRequestId: claims.action_id,
    toState: ACTION_STATES.CONSUMED,
    reason: 'Scoped one-time authorization token atomically consumed',
    metadata: { jti: claims.jti },
    expectedActionHash: claims.action_hash,
  });

  recordAuditEvent({
    db,
    organisationId: claims.organisation_id,
    actionRequestId: claims.action_id,
    eventType: 'TOKEN_CONSUMED',
    payload: { jti: claims.jti, scope: claims.scope },
  });

  return { consumed: true, jti: claims.jti, actionId: claims.action_id, consumedAt: nowIso };
}
