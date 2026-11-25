import crypto from 'node:crypto';
import { canonicalizeJson, computeEnvelopeHash } from '../crypto.mjs';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { ACTION_STATES, transitionActionState, verifyLatestEnvelopeIntegrity } from './stateMachine.mjs';

export const ACTION_CATEGORIES = Object.freeze({
  GITHUB_DEPLOYMENT: 'GITHUB_DEPLOYMENT',
  FINANCE_APPROVAL: 'FINANCE_APPROVAL',
});

function requireNonEmptyString(val, field) {
  const s = typeof val === 'string' ? val.trim() : '';
  if (!s) throw new ValidationError(`Missing required field: ${field}`);
  return s;
}

export function normalizeActionParameters(category, params) {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('Action parameters object is required');
  }

  if (category === ACTION_CATEGORIES.GITHUB_DEPLOYMENT) {
    return {
      repositoryOwner: requireNonEmptyString(params.repositoryOwner, 'parameters.repositoryOwner'),
      repositoryName: requireNonEmptyString(params.repositoryName, 'parameters.repositoryName'),
      commitSha: requireNonEmptyString(params.commitSha, 'parameters.commitSha'),
      workflowRunId: String(requireNonEmptyString(String(params.workflowRunId || ''), 'parameters.workflowRunId')),
      targetEnvironment: requireNonEmptyString(params.targetEnvironment, 'parameters.targetEnvironment'),
      deploymentParams: params.deploymentParams && typeof params.deploymentParams === 'object' ? params.deploymentParams : {},
    };
  }

  if (category === ACTION_CATEGORIES.FINANCE_APPROVAL) {
    const numericAmount = Number(params.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new ValidationError('parameters.amount must be a positive number');
    }
    return {
      vendorReference: requireNonEmptyString(params.vendorReference, 'parameters.vendorReference'),
      beneficiaryReference: requireNonEmptyString(params.beneficiaryReference, 'parameters.beneficiaryReference'),
      amount: numericAmount.toFixed(2),
      currency: requireNonEmptyString(params.currency, 'parameters.currency').toUpperCase(),
      purpose: requireNonEmptyString(params.purpose, 'parameters.purpose'),
    };
  }

  throw new ValidationError(`Unsupported action category: ${category}`);
}

export function buildCanonicalEnvelopePayload({
  actionId,
  organisationId,
  requester,
  claimedApprover,
  category,
  sourceIntegration,
  targetSystem,
  environment,
  parameters,
  expiresAt,
  version,
}) {
  return {
    action_id: actionId,
    organisation_id: organisationId,
    requester: {
      id: requester.id,
      email: requester.email,
      roles: [...(requester.roles || [])].sort(),
    },
    claimed_approver: {
      id: claimedApprover.id,
      email: claimedApprover.email,
    },
    action_category: category,
    source_integration: sourceIntegration,
    target_system: targetSystem,
    environment,
    parameters,
    expires_at: expiresAt,
    version,
  };
}

function resolveUserByIdOrEmail(db, organisationId, { userId, email }) {
  if (userId) {
    return db
      .prepare('SELECT id, email, display_name, title, department, is_active FROM users WHERE id = ? AND organisation_id = ?')
      .get(userId, organisationId);
  }
  if (email) {
    return db
      .prepare(
        'SELECT id, email, display_name, title, department, is_active FROM users WHERE lower(email) = ? AND organisation_id = ?',
      )
      .get(String(email).trim().toLowerCase(), organisationId);
  }
  return null;
}

export function createActionRequest({ db, authCtx, input }) {
  const category = requireNonEmptyString(input.category, 'category');
  const sourceIntegration =
    input.sourceIntegration || (category === ACTION_CATEGORIES.GITHUB_DEPLOYMENT ? 'github_actions' : 'finance_sandbox');
  const targetSystem =
    input.targetSystem || (category === ACTION_CATEGORIES.GITHUB_DEPLOYMENT ? 'github_environment' : 'erp_treasury_sandbox');
  const environment = requireNonEmptyString(
    input.environment || input.parameters?.targetEnvironment || 'production',
    'environment',
  );
  const riskTier = input.riskTier || 'CRITICAL';
  const normalizedParams = normalizeActionParameters(category, input.parameters);

  const approver = resolveUserByIdOrEmail(db, authCtx.organisation.id, {
    userId: input.claimedApproverUserId,
    email: input.claimedApproverEmail,
  });
  if (!approver || !approver.is_active) {
    throw new ValidationError('Designated approver not found in organisation');
  }
  if (approver.id === authCtx.user.id) {
    throw new ForbiddenError('Separation of duties violation: requester cannot be designated as approver');
  }

  const ttlSeconds = Math.min(Math.max(Number(input.ttlSeconds || 900), 60), 86400);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const actionId = `env_${crypto.randomBytes(6).toString('hex')}`;
  const envelopeRowId = `aev_${crypto.randomBytes(8).toString('hex')}`;

  const canonicalObj = buildCanonicalEnvelopePayload({
    actionId,
    organisationId: authCtx.organisation.id,
    requester: authCtx.user,
    claimedApprover: { id: approver.id, email: approver.email },
    category,
    sourceIntegration,
    targetSystem,
    environment,
    parameters: normalizedParams,
    expiresAt,
    version: 1,
  });

  const canonicalJson = canonicalizeJson(canonicalObj);
  const actionHash = computeEnvelopeHash(canonicalObj);

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `INSERT INTO action_requests
        (id, organisation_id, requester_user_id, claimed_approver_user_id, category, source_integration, target_system, environment, risk_tier, current_state, current_version, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(
      actionId,
      authCtx.organisation.id,
      authCtx.user.id,
      approver.id,
      category,
      sourceIntegration,
      targetSystem,
      environment,
      riskTier,
      ACTION_STATES.PENDING,
      expiresAt,
      nowIso,
      nowIso,
    );

    db.prepare(
      `INSERT INTO action_envelopes (id, action_request_id, version, canonical_json, action_hash, created_at)
       VALUES (?, ?, 1, ?, ?, ?)`,
    ).run(envelopeRowId, actionId, canonicalJson, actionHash, nowIso);

    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actionRequestId: actionId,
      actorUserId: authCtx.user.id,
      eventType: 'ENVELOPE_CREATED',
      payload: { version: 1, actionHash, category, claimedApproverId: approver.id },
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return getActionRequestDetail(db, authCtx.organisation.id, actionId);
}

export function mutateActionEnvelope({ db, authCtx, actionRequestId, updatedParameters, reason = 'Payload modified' }) {
  const existing = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!existing) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }

  if ([ACTION_STATES.REJECTED, ACTION_STATES.EXPIRED, ACTION_STATES.CONSUMED].includes(existing.current_state)) {
    throw new ConflictError(`Cannot mutate terminal action request in state ${existing.current_state}`);
  }

  const currentEnvelope = db
    .prepare('SELECT * FROM action_envelopes WHERE action_request_id = ? AND version = ?')
    .get(actionRequestId, existing.current_version);
  const currentPayload = JSON.parse(currentEnvelope.canonical_json);

  const mergedParams = normalizeActionParameters(existing.category, {
    ...currentPayload.parameters,
    ...(updatedParameters || {}),
  });

  const nextVersion = existing.current_version + 1;
  const nextObj = {
    ...currentPayload,
    parameters: mergedParams,
    version: nextVersion,
  };
  const nextCanonicalJson = canonicalizeJson(nextObj);
  const nextHash = computeEnvelopeHash(nextObj);

  // Check if material parameters changed compared to current version (ignoring version counter)
  const prevComparableHash = computeEnvelopeHash({ ...currentPayload, version: 0 });
  const nextComparableHash = computeEnvelopeHash({ ...nextObj, version: 0 });
  if (prevComparableHash === nextComparableHash) {
    return { mutated: false, action: getActionRequestDetail(db, authCtx.organisation.id, actionRequestId) };
  }

  const nowIso = new Date().toISOString();
  const nextEnvelopeId = `aev_${crypto.randomBytes(8).toString('hex')}`;

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `INSERT INTO action_envelopes (id, action_request_id, version, canonical_json, action_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(nextEnvelopeId, actionRequestId, nextVersion, nextCanonicalJson, nextHash, nowIso);

    db.prepare('UPDATE action_requests SET current_version = ?, updated_at = ? WHERE id = ?').run(
      nextVersion,
      nowIso,
      actionRequestId,
    );

    // Invalidate all prior unconsumed challenges and approvals
    db.prepare('UPDATE voice_challenges SET consumed_at = ? WHERE action_request_id = ? AND consumed_at IS NULL').run(
      nowIso,
      actionRequestId,
    );
    db.prepare("UPDATE approvals SET decision = 'INVALIDATED' WHERE action_request_id = ?").run(actionRequestId);

    // Open security incident if payload changed after any prior challenge/approval
    const hadPriorEvidence = db
      .prepare('SELECT id FROM voice_challenges WHERE action_request_id = ? LIMIT 1')
      .get(actionRequestId);
    const hadPriorApproval = db
      .prepare('SELECT id FROM approvals WHERE action_request_id = ? LIMIT 1')
      .get(actionRequestId);
    if (hadPriorEvidence || hadPriorApproval) {
      db.prepare(
        `INSERT INTO security_incidents
          (id, organisation_id, action_request_id, severity, title, reason, status, created_at, updated_at)
         VALUES (?, ?, ?, 'SEV-1 CRITICAL', ?, ?, 'OPEN', ?, ?)`,
      ).run(
        `inc_${crypto.randomBytes(5).toString('hex')}`,
        authCtx.organisation.id,
        actionRequestId,
        'Post-issuance action payload mutation (hash drift)',
        `${reason} (${currentEnvelope.action_hash.slice(0, 18)} -> ${nextHash.slice(0, 18)})`,
        nowIso,
        nowIso,
      );
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  transitionActionState({
    db,
    actionRequestId,
    toState: ACTION_STATES.INVALIDATED,
    actorUserId: authCtx.user.id,
    reason,
    metadata: {
      previousVersion: existing.current_version,
      newVersion: nextVersion,
      previousHash: currentEnvelope.action_hash,
      newHash: nextHash,
    },
    skipIntegrityCheck: true,
  });

  return {
    mutated: true,
    previousHash: currentEnvelope.action_hash,
    newHash: nextHash,
    action: getActionRequestDetail(db, authCtx.organisation.id, actionRequestId),
  };
}

function loadActionExtras(db, actionRequestId, currentVersion) {
  const challenge = db
    .prepare('SELECT id, nonce, phrase, stt_status, stt_transcript, expires_at, created_at FROM voice_challenges WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(actionRequestId);
  const verification = db
    .prepare(
      `SELECT id, eidos_operation_id, eidos_decision, eidos_similarity, aletheia_operation_id, aletheia_verdict, aletheia_score, evidence_status, updated_at
       FROM voice_verifications WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(actionRequestId);
  const approvals = db
    .prepare(
      `SELECT a.id, a.approver_user_id, u.email AS approver_email, u.display_name AS approver_name,
              a.approval_kind, a.decision, a.action_hash, a.reason, a.created_at
       FROM approvals a
       LEFT JOIN users u ON u.id = a.approver_user_id
       WHERE a.action_request_id = ?
       ORDER BY a.created_at ASC`,
    )
    .all(actionRequestId);
  const permit = db
    .prepare(
      `SELECT jti, scope, target_integration, environment, expires_at, consumed_at, created_at
       FROM authorization_tokens WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(actionRequestId);
  const ingressRow = db
    .prepare('SELECT version, canonical_json, action_hash FROM action_envelopes WHERE action_request_id = ? AND version = 1')
    .get(actionRequestId);

  return {
    latestChallenge: challenge || null,
    latestVerification: verification || null,
    approvals,
    issuedPermit: permit || null,
    ingressHash: ingressRow?.action_hash || null,
    ingressPayload: ingressRow ? JSON.parse(ingressRow.canonical_json) : null,
    hasVersionDrift: Boolean(currentVersion > 1),
  };
}

export function listActionRequests(db, organisationId, { state, category } = {}) {
  let sql = `
    SELECT ar.*, ae.action_hash, ae.canonical_json,
           req.email AS requester_email, req.display_name AS requester_name,
           app.email AS approver_email, app.display_name AS approver_name
    FROM action_requests ar
    JOIN action_envelopes ae ON ae.action_request_id = ar.id AND ae.version = ar.current_version
    LEFT JOIN users req ON req.id = ar.requester_user_id
    LEFT JOIN users app ON app.id = ar.claimed_approver_user_id
    WHERE ar.organisation_id = ?
  `;
  const params = [organisationId];
  if (state) {
    sql += ' AND ar.current_state = ?';
    params.push(state);
  }
  if (category) {
    sql += ' AND ar.category = ?';
    params.push(category);
  }
  sql += ' ORDER BY ar.created_at DESC';

  return db
    .prepare(sql)
    .all(...params)
    .map((r) => {
      const extras = loadActionExtras(db, r.id, r.current_version);
      return {
        id: r.id,
        organisationId: r.organisation_id,
        category: r.category,
        sourceIntegration: r.source_integration,
        targetSystem: r.target_system,
        environment: r.environment,
        riskTier: r.risk_tier,
        state: r.current_state,
        version: r.current_version,
        actionHash: r.action_hash,
        requester: { id: r.requester_user_id, email: r.requester_email, name: r.requester_name },
        claimedApprover: { id: r.claimed_approver_user_id, email: r.approver_email, name: r.approver_name },
        envelope: JSON.parse(r.canonical_json),
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        ...extras,
      };
    });
}

export function getActionRequestDetail(db, organisationId, actionRequestId) {
  const row = db
    .prepare(
      `SELECT ar.*, req.email AS requester_email, req.display_name AS requester_name,
              app.email AS approver_email, app.display_name AS approver_name
       FROM action_requests ar
       LEFT JOIN users req ON req.id = ar.requester_user_id
       LEFT JOIN users app ON app.id = ar.claimed_approver_user_id
       WHERE ar.id = ? AND ar.organisation_id = ?`,
    )
    .get(actionRequestId, organisationId);

  if (!row) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }

  const versions = db
    .prepare('SELECT id, version, canonical_json, action_hash, created_at FROM action_envelopes WHERE action_request_id = ? ORDER BY version DESC')
    .all(actionRequestId)
    .map((v) => ({
      id: v.id,
      version: v.version,
      actionHash: v.action_hash,
      canonicalPayload: JSON.parse(v.canonical_json),
      createdAt: v.created_at,
    }));

  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId);
  const extras = loadActionExtras(db, actionRequestId, row.current_version);

  return {
    id: row.id,
    organisationId: row.organisation_id,
    category: row.category,
    sourceIntegration: row.source_integration,
    targetSystem: row.target_system,
    environment: row.environment,
    riskTier: row.risk_tier,
    state: row.current_state,
    version: row.current_version,
    actionHash: versions[0]?.actionHash,
    hashIntegrityValid: integrity.valid,
    requester: { id: row.requester_user_id, email: row.requester_email, name: row.requester_name },
    claimedApprover: { id: row.claimed_approver_user_id, email: row.approver_email, name: row.approver_name },
    envelope: versions[0]?.canonicalPayload,
    versions,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

export function rejectActionRequest({ db, authCtx, actionRequestId, reason = 'Explicitly rejected' }) {
  const row = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!row) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }
  if (row.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Requester cannot arbitrate their own action request');
  }
  return transitionActionState({
    db,
    actionRequestId,
    toState: ACTION_STATES.REJECTED,
    actorUserId: authCtx.user.id,
    reason,
    skipIntegrityCheck: true,
  });
}
