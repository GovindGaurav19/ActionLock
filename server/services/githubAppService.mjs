import crypto from 'node:crypto';
import {
  canonicalizeJson,
  computeEnvelopeHash,
  createGitHubAppJwt,
  verifyGitHubWebhookSignature,
} from '../crypto.mjs';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ProviderError,
  ValidationError,
} from '../utils/errors.mjs';
import { logger } from '../utils/logger.mjs';
import { consumeScopedPermitToken } from './approvalAndTokenService.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { ACTION_CATEGORIES, buildCanonicalEnvelopePayload, normalizeActionParameters } from './envelopeService.mjs';
import { ACTION_STATES, transitionActionState } from './stateMachine.mjs';

const DEFAULT_GITHUB_API_BASE = 'https://api.github.com';
const ALLOWED_CALLBACK_PATH_RE = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/deployment_protection_rule$/;

/**
 * Validates and extracts { owner, repo, runId } from a GitHub deployment_callback_url
 * to prevent SSRF via forged callback URLs.
 */
export function parseGitHubCallbackUrl(callbackUrl) {
  let parsed;
  try {
    parsed = new URL(String(callbackUrl || ''));
  } catch {
    throw new ValidationError('Invalid deployment_callback_url format');
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('deployment_callback_url must use https protocol');
  }
  if (parsed.hostname !== 'api.github.com' && !parsed.hostname.endsWith('.github.com')) {
    throw new ValidationError(`Untrusted GitHub callback hostname: ${parsed.hostname}`);
  }
  const match = parsed.pathname.match(ALLOWED_CALLBACK_PATH_RE);
  if (!match) {
    throw new ValidationError('deployment_callback_url does not match /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule');
  }
  return {
    url: parsed.toString(),
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
    runId: match[3],
  };
}

/**
 * Exchanges a signed RS256 GitHub App JWT for an installation-scoped access token.
 */
export async function exchangeInstallationAccessToken({
  config,
  installationId,
  fetchImpl = fetch,
  apiBaseUrl = DEFAULT_GITHUB_API_BASE,
}) {
  if (!config.github?.appId || !config.github?.privateKey) {
    throw new ProviderError('GitHub App credentials (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) are not configured', {
      statusCode: 503,
      code: 'GITHUB_NOT_CONFIGURED',
    });
  }
  if (!installationId) {
    throw new ValidationError('GitHub installation_id is required to mint installation access token');
  }

  let appJwt;
  try {
    appJwt = createGitHubAppJwt({
      appId: config.github.appId,
      privateKeyPem: config.github.privateKey,
    });
  } catch (err) {
    throw new ProviderError(`Failed to sign GitHub App JWT: ${err.message}`, {
      statusCode: 500,
      code: 'GITHUB_JWT_ERROR',
    });
  }

  const endpoint = `${apiBaseUrl.replace(/\/+$/, '')}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`;
  const resp = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ACTIONLOCK-Enterprise-Gateway',
    },
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.token) {
    throw new ProviderError(
      data?.message || `GitHub installation token exchange failed (${resp.status})`,
      { statusCode: 502, code: 'GITHUB_API_ERROR' },
    );
  }

  return {
    token: data.token,
    expiresAt: data.expires_at || null,
  };
}

/**
 * Posts deployment protection rule review ("approved" or "rejected") to GitHub Actions API.
 */
export async function postDeploymentProtectionRuleDecision({
  callbackUrl,
  owner,
  repo,
  runId,
  installationToken,
  environmentName,
  state,
  comment,
  fetchImpl = fetch,
}) {
  if (!['approved', 'rejected'].includes(state)) {
    throw new ValidationError('GitHub deployment protection state must be approved or rejected');
  }
  if (!installationToken) {
    throw new ProviderError('Missing GitHub installation access token', { statusCode: 502, code: 'GITHUB_TOKEN_MISSING' });
  }

  const targetUrl = callbackUrl
    ? parseGitHubCallbackUrl(callbackUrl).url
    : `${DEFAULT_GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(String(runId))}/deployment_protection_rule`;

  const resp = await fetchImpl(targetUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${installationToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'ACTIONLOCK-Enterprise-Gateway',
    },
    body: JSON.stringify({
      environment_name: environmentName,
      state,
      comment: comment || `ACTIONLOCK authorization decision: ${state}`,
    }),
  });

  const rawText = await resp.text().catch(() => '');
  let body = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = { rawText };
  }

  if (!resp.ok) {
    throw new ProviderError(
      body?.message || `GitHub deployment protection callback failed (${resp.status})`,
      { statusCode: 502, code: 'GITHUB_CALLBACK_ERROR' },
    );
  }

  return {
    ok: true,
    status: resp.status,
    url: targetUrl,
    state,
    body,
  };
}

function findMatchingPendingGitHubAction(db, { organisationId, owner, repo, runId, environment }) {
  const rows = db
    .prepare(
      `SELECT ar.id, ar.current_state, ae.canonical_json
       FROM action_requests ar
       JOIN action_envelopes ae ON ae.action_request_id = ar.id AND ae.version = ar.current_version
       WHERE ar.organisation_id = ?
         AND ar.category = 'GITHUB_DEPLOYMENT'
         AND ar.environment = ?
         AND ar.current_state NOT IN ('CONSUMED', 'REJECTED', 'EXPIRED')
       ORDER BY ar.created_at DESC`,
    )
    .all(organisationId, environment);

  for (const row of rows) {
    const env = JSON.parse(row.canonical_json);
    const p = env.parameters || {};
    if (
      p.repositoryOwner === owner &&
      p.repositoryName === repo &&
      String(p.workflowRunId) === String(runId)
    ) {
      return row;
    }
  }
  return null;
}

function resolveRequesterForGitHubActor(db, organisationId, actorLogin) {
  if (actorLogin) {
    const byHandle = db
      .prepare(
        `SELECT id, email, display_name FROM users
         WHERE organisation_id = ? AND is_active = 1 AND (lower(email) LIKE ? OR lower(display_name) LIKE ?)
         LIMIT 1`,
      )
      .get(organisationId, `${String(actorLogin).toLowerCase()}%`, `%${String(actorLogin).toLowerCase()}%`);
    if (byHandle) return byHandle;
  }
  // Fallback to seeded DevOps requester; note external GitHub actor is recorded explicitly in envelope params
  return (
    db
      .prepare("SELECT id, email, display_name FROM users WHERE id = 'usr_alex_chen' AND organisation_id = ?")
      .get(organisationId) ||
    db.prepare('SELECT id, email, display_name FROM users WHERE organisation_id = ? AND is_active = 1 LIMIT 1').get(organisationId)
  );
}

function resolveDefaultApprover(db, organisationId, requesterId) {
  return (
    db
      .prepare(
        "SELECT id, email, display_name FROM users WHERE id = 'usr_sarah_jenkins' AND organisation_id = ? AND id != ?",
      )
      .get(organisationId, requesterId) ||
    db
      .prepare(
        `SELECT DISTINCT u.id, u.email, u.display_name
         FROM users u
         JOIN role_assignments ra ON ra.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ra.role_id
         WHERE u.organisation_id = ? AND u.id != ? AND rp.permission = 'action:approve'
         LIMIT 1`,
      )
      .get(organisationId, requesterId)
  );
}

/**
 * Verifies GitHub X-Hub-Signature-256 over raw bytes, deduplicates by X-GitHub-Delivery,
 * stores webhook delivery record, and correlates/creates a pending GITHUB_DEPLOYMENT envelope.
 * Never auto-approves deployments from inbound webhook events.
 */
export function ingestGitHubWebhook({ db, config, headers, rawBody }) {
  const sigHeader = headers['x-hub-signature-256'];
  const eventType = String(headers['x-github-event'] || 'unknown');
  const deliveryId = String(headers['x-github-delivery'] || '');

  const sigCheck = verifyGitHubWebhookSignature({
    secret: config.github?.webhookSecret,
    signatureHeader: sigHeader,
    rawBody,
  });

  if (!sigCheck.valid) {
    return { status: 401, body: { accepted: false, reason: sigCheck.reason } };
  }

  if (!deliveryId) {
    return { status: 400, body: { accepted: false, reason: 'missing_github_delivery_header' } };
  }

  const existingDelivery = db
    .prepare("SELECT id FROM webhook_events WHERE provider = 'github' AND webhook_id = ?")
    .get(deliveryId);
  if (existingDelivery) {
    return { status: 200, body: { accepted: true, deduplicated: true, deliveryId } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { accepted: false, reason: 'invalid_json' } };
  }

  const now = new Date().toISOString();
  const webhookRowId = `whk_${crypto.randomBytes(6).toString('hex')}`;

  if (eventType === 'ping') {
    db.prepare(
      `INSERT INTO webhook_events
        (id, provider, webhook_id, event_type, operation_id, signature_valid, processing_status, payload_json, received_at, processed_at)
       VALUES (?, 'github', ?, 'ping', NULL, 1, 'PROCESSED', ?, ?, ?)`,
    ).run(webhookRowId, deliveryId, rawBody.toString('utf8'), now, now);
    return { status: 200, body: { accepted: true, event: 'ping', deliveryId } };
  }

  if (eventType !== 'deployment_protection_rule') {
    db.prepare(
      `INSERT INTO webhook_events
        (id, provider, webhook_id, event_type, operation_id, signature_valid, processing_status, payload_json, received_at, processed_at)
       VALUES (?, 'github', ?, ?, NULL, 1, 'IGNORED', ?, ?, ?)`,
    ).run(webhookRowId, deliveryId, eventType, rawBody.toString('utf8'), now, now);
    return { status: 200, body: { accepted: true, event: eventType, ignored: true, deliveryId } };
  }

  // Validate callback URL & required GitHub deployment_protection_rule fields
  let callbackMeta;
  try {
    callbackMeta = parseGitHubCallbackUrl(payload.deployment_callback_url);
  } catch (err) {
    return { status: 400, body: { accepted: false, reason: err.message } };
  }

  const environment = String(payload.environment || 'production').trim() || 'production';
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  const commitSha = String(payload.deployment?.sha || payload.workflow_run?.head_sha || 'unknown-sha');
  const actorLogin = payload.sender?.login || payload.deployment?.creator?.login || 'github-actions';
  const orgRow = db.prepare('SELECT id FROM organisations ORDER BY created_at ASC LIMIT 1').get();
  if (!orgRow) {
    throw new NotFoundError('No organisation initialised to receive GitHub webhook');
  }

  const matched = findMatchingPendingGitHubAction(db, {
    organisationId: orgRow.id,
    owner: callbackMeta.owner,
    repo: callbackMeta.repo,
    runId: callbackMeta.runId,
    environment,
  });

  let actionId = matched?.id || null;
  let createdNewAction = false;

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `INSERT INTO webhook_events
        (id, provider, webhook_id, event_type, operation_id, signature_valid, processing_status, payload_json, received_at, processed_at)
       VALUES (?, 'github', ?, ?, ?, 1, 'PROCESSED', ?, ?, ?)`,
    ).run(
      webhookRowId,
      deliveryId,
      eventType,
      `${callbackMeta.owner}/${callbackMeta.repo}#${callbackMeta.runId}`,
      rawBody.toString('utf8'),
      now,
      now,
    );

    if (!actionId) {
      const requester = resolveRequesterForGitHubActor(db, orgRow.id, actorLogin);
      const approver = resolveDefaultApprover(db, orgRow.id, requester.id);
      const reqRoles = db
        .prepare(
          `SELECT r.name FROM roles r JOIN role_assignments ra ON ra.role_id = r.id WHERE ra.user_id = ? AND ra.organisation_id = ?`,
        )
        .all(requester.id, orgRow.id)
        .map((r) => r.name);

      actionId = `env_${crypto.randomBytes(6).toString('hex')}`;
      const envelopeRowId = `aev_${crypto.randomBytes(8).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 900 * 1000).toISOString();

      const normalizedParams = normalizeActionParameters(ACTION_CATEGORIES.GITHUB_DEPLOYMENT, {
        repositoryOwner: callbackMeta.owner,
        repositoryName: callbackMeta.repo,
        commitSha,
        workflowRunId: callbackMeta.runId,
        targetEnvironment: environment,
        deploymentParams: {
          deploymentCallbackUrl: callbackMeta.url,
          installationId,
          deploymentId: payload.deployment?.id ? String(payload.deployment.id) : null,
          githubActorLogin: actorLogin,
          githubEvent: payload.event || 'workflow_dispatch',
          deliveryId,
        },
      });

      const canonicalObj = buildCanonicalEnvelopePayload({
        actionId,
        organisationId: orgRow.id,
        requester: { id: requester.id, email: requester.email, roles: reqRoles },
        claimedApprover: { id: approver.id, email: approver.email },
        category: ACTION_CATEGORIES.GITHUB_DEPLOYMENT,
        sourceIntegration: 'github_actions',
        targetSystem: 'github_environment',
        environment,
        parameters: normalizedParams,
        expiresAt,
        version: 1,
      });

      const canonicalJson = canonicalizeJson(canonicalObj);
      const actionHash = computeEnvelopeHash(canonicalObj);

      db.prepare(
        `INSERT INTO action_requests
          (id, organisation_id, requester_user_id, claimed_approver_user_id, category, source_integration, target_system, environment, risk_tier, current_state, current_version, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'github_actions', 'github_environment', ?, 'CRITICAL', ?, 1, ?, ?, ?)`,
      ).run(
        actionId,
        orgRow.id,
        requester.id,
        approver.id,
        ACTION_CATEGORIES.GITHUB_DEPLOYMENT,
        environment,
        ACTION_STATES.PENDING,
        expiresAt,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO action_envelopes (id, action_request_id, version, canonical_json, action_hash, created_at)
         VALUES (?, ?, 1, ?, ?, ?)`,
      ).run(envelopeRowId, actionId, canonicalJson, actionHash, now);

      recordAuditEvent({
        db,
        organisationId: orgRow.id,
        actionRequestId: actionId,
        actorUserId: requester.id,
        eventType: 'ENVELOPE_CREATED',
        payload: {
          version: 1,
          actionHash,
          source: 'github_webhook',
          deliveryId,
          runId: callbackMeta.runId,
          installationId,
        },
      });
      createdNewAction = true;
    }

    // Record / update GitHub integration record
    const existingInt = db
      .prepare("SELECT id FROM integrations WHERE organisation_id = ? AND kind = 'github_app'")
      .get(orgRow.id);
    const cfgJson = JSON.stringify({
      lastDeliveryId: deliveryId,
      lastRepository: `${callbackMeta.owner}/${callbackMeta.repo}`,
      lastInstallationId: installationId,
      lastEnvironment: environment,
    });
    if (existingInt) {
      db.prepare("UPDATE integrations SET status = 'CONNECTED', config_json = ?, updated_at = ? WHERE id = ?").run(
        cfgJson,
        now,
        existingInt.id,
      );
    } else {
      db.prepare(
        "INSERT INTO integrations (id, organisation_id, kind, status, config_json, updated_at) VALUES (?, ?, 'github_app', 'CONNECTED', ?, ?)",
      ).run(`int_${crypto.randomBytes(5).toString('hex')}`, orgRow.id, cfgJson, now);
    }

    recordAuditEvent({
      db,
      organisationId: orgRow.id,
      actionRequestId: actionId,
      eventType: 'GITHUB_WEBHOOK_RECEIVED',
      payload: {
        deliveryId,
        eventType,
        repository: `${callbackMeta.owner}/${callbackMeta.repo}`,
        runId: callbackMeta.runId,
        environment,
        createdNewAction,
      },
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    logger.error('Failed ingesting GitHub deployment webhook', { deliveryId, err: err?.message });
    throw err;
  }

  return {
    status: 200,
    body: {
      accepted: true,
      deduplicated: false,
      deliveryId,
      actionId,
      createdNewAction,
      state: ACTION_STATES.PENDING,
    },
  };
}

/**
 * Executes the final GitHub deployment protection callback ("approved" or "rejected").
 * - "approved" requires consuming a valid single-use scoped permit JWT minted for this exact action.
 * - "rejected" transitions the action to REJECTED (if not already) under SoD guard.
 */
export async function executeGitHubDeploymentCallback(
  {
    db,
    config,
    authCtx,
    actionRequestId,
    decision,
    permitToken = '',
    installationId: overrideInstallationId = null,
    comment = '',
  },
  deps = {},
) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new ValidationError('decision must be approved or rejected');
  }

  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!action) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }
  if (action.category !== ACTION_CATEGORIES.GITHUB_DEPLOYMENT) {
    throw new ValidationError(`Action ${actionRequestId} is not a GITHUB_DEPLOYMENT request`);
  }
  if (action.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Separation of duties violation: requester cannot release or reject own deployment');
  }

  const envelopeRow = db
    .prepare('SELECT canonical_json, action_hash FROM action_envelopes WHERE action_request_id = ? AND version = ?')
    .get(actionRequestId, action.current_version);
  if (!envelopeRow) {
    throw new NotFoundError('Action envelope not found');
  }

  const envelope = JSON.parse(envelopeRow.canonical_json);
  const params = envelope.parameters || {};
  const depParams = params.deploymentParams || {};
  const callbackUrl = depParams.deploymentCallbackUrl
    ? parseGitHubCallbackUrl(depParams.deploymentCallbackUrl).url
    : null;
  const installationId = overrideInstallationId || depParams.installationId;

  if (!installationId) {
    throw new ValidationError('No GitHub installationId available on action envelope or request');
  }
  if (!deps.exchangeToken && (!config.github?.appId || !config.github?.privateKey)) {
    throw new ProviderError('GitHub App credentials (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) are not configured', {
      statusCode: 503,
      code: 'GITHUB_NOT_CONFIGURED',
    });
  }

  let consumedTokenMeta = null;
  if (decision === 'approved') {
    if (!permitToken) {
      throw new ForbiddenError('A scoped single-use authorization permit token is required to approve deployment');
    }
    consumedTokenMeta = consumeScopedPermitToken({
      db,
      config,
      rawToken: permitToken,
      expectedActionId: actionRequestId,
      expectedScope: `${action.category}:${action.id}`,
      expectedTargetIntegration: 'github_actions',
      expectedEnvironment: action.environment,
    });
  } else {
    // decision === 'rejected'
    if (action.current_state === ACTION_STATES.CONSUMED || action.current_state === ACTION_STATES.TOKEN_ISSUED) {
      throw new ConflictError(`Cannot send rejected GitHub callback in state ${action.current_state}`);
    }
    if (action.current_state !== ACTION_STATES.REJECTED) {
      transitionActionState({
        db,
        actionRequestId,
        toState: ACTION_STATES.REJECTED,
        actorUserId: authCtx.user.id,
        reason: comment || 'Rejected before GitHub deployment protection callback',
        skipIntegrityCheck: true,
      });
    }
  }

  const client = {
    exchangeToken: deps.exchangeToken || ((args) => exchangeInstallationAccessToken(args)),
    postDecision: deps.postDecision || ((args) => postDeploymentProtectionRuleDecision(args)),
  };

  try {
    const tokenRes = await client.exchangeToken({
      config,
      installationId,
    });

    const ghRes = await client.postDecision({
      callbackUrl,
      owner: params.repositoryOwner,
      repo: params.repositoryName,
      runId: params.workflowRunId,
      installationToken: tokenRes.token,
      environmentName: params.targetEnvironment || action.environment,
      state: decision,
      comment:
        comment ||
        `ACTIONLOCK ${decision === 'approved' ? 'authorized release' : 'rejected deployment'} (action=${actionRequestId}${consumedTokenMeta ? `, jti=${consumedTokenMeta.jti}` : ''})`,
    });

    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actionRequestId,
      actorUserId: authCtx.user.id,
      eventType: decision === 'approved' ? 'GITHUB_DEPLOYMENT_RELEASED' : 'GITHUB_DEPLOYMENT_REJECTED',
      payload: {
        decision,
        owner: params.repositoryOwner,
        repo: params.repositoryName,
        runId: params.workflowRunId,
        environment: action.environment,
        installationId,
        jti: consumedTokenMeta?.jti || null,
        callbackUrl: ghRes.url,
        httpStatus: ghRes.status,
      },
    });

    return {
      ok: true,
      actionId: actionRequestId,
      decision,
      githubStatus: ghRes.status,
      callbackUrl: ghRes.url,
      consumedTokenJti: consumedTokenMeta?.jti || null,
    };
  } catch (err) {
    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actionRequestId,
      actorUserId: authCtx.user.id,
      eventType: 'GITHUB_CALLBACK_FAILED',
      payload: {
        decision,
        installationId,
        jti: consumedTokenMeta?.jti || null,
        error: err?.message,
      },
    });
    throw err;
  }
}

export function getGitHubIntegrationStatus(db, config) {
  const row = db
    .prepare("SELECT status, config_json, updated_at FROM integrations WHERE kind = 'github_app' ORDER BY updated_at DESC LIMIT 1")
    .get();
  const webhookCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM webhook_events WHERE provider = 'github'")
    .get()?.cnt || 0;

  return {
    configured: Boolean(config.github?.appId && config.github?.privateKey),
    webhookSecretConfigured: Boolean(config.github?.webhookSecret),
    appIdPresent: Boolean(config.github?.appId),
    lastActivity: row ? { ...JSON.parse(row.config_json), updatedAt: row.updated_at, status: row.status } : null,
    webhookDeliveryCount: webhookCount,
  };
}
