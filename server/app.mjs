import http from 'node:http';
import crypto from 'node:crypto';
import { getDetectifAiConfigStatus } from './detectifai.mjs';
import { createRateLimiter } from './middleware/rateLimit.mjs';
import {
  consumeScopedPermitToken,
  issueScopedPermitToken,
  recordPeerApproval,
} from './services/approvalAndTokenService.mjs';
import { listAuditEvents, verifyAuditChain } from './services/auditService.mjs';
import { createBreakGlassEvent, listBreakGlassEvents } from './services/breakGlassService.mjs';
import { listIncidents, updateIncidentStatus } from './services/incidentService.mjs';
import {
  buildSessionCookieHeader,
  getAuthenticatedContext,
  listDemoAccounts,
  loginWithPassword,
  logoutSession,
  parseCookies,
  requireAuth,
  requirePermission,
} from './services/authService.mjs';
import { issueVoiceChallenge } from './services/challengeService.mjs';
import {
  createActionRequest,
  getActionRequestDetail,
  listActionRequests,
  mutateActionEnvelope,
  rejectActionRequest,
} from './services/envelopeService.mjs';
import { getDashboardSummary } from './services/dashboardService.mjs';
import { getOrganisationDetails } from './services/orgService.mjs';
import {
  createPolicy,
  evaluateActionPolicy,
  listPolicies,
  updatePolicy,
} from './services/policyEngineService.mjs';
import {
  deleteSpeakerProfile,
  enrollSpeakerProfile,
  listSpeakerProfiles,
} from './services/speakerRegistryService.mjs';
import { verifyLatestEnvelopeIntegrity } from './services/stateMachine.mjs';
import {
  getVerificationSummary,
  recoverDetectifAiOperation,
  submitVoiceChallengeRecording,
} from './services/voiceVerificationService.mjs';
import {
  finishActionPasskeyAuth,
  finishPasskeyRegistration,
  startActionPasskeyAuth,
  startPasskeyRegistration,
} from './services/webauthnService.mjs';
import {
  executeGitHubDeploymentCallback,
  getGitHubIntegrationStatus,
  ingestGitHubWebhook,
} from './services/githubAppService.mjs';
import { ingestDetectifAiWebhook, listWebhookEvents } from './services/webhookService.mjs';
import { NotFoundError, toSafeErrorPayload, ValidationError } from './utils/errors.mjs';
import { logger } from './utils/logger.mjs';

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function readRawBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new ValidationError('Request payload exceeds maximum allowed size'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJsonBuffer(buf) {
  if (!buf || buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new ValidationError('Invalid JSON request body');
  }
}

export function createApp({
  db,
  config,
  speakerProvider = undefined,
  sttProvider = undefined,
  verifyProvider = undefined,
  fetchOperationProvider = undefined,
  webauthnProvider = undefined,
  githubProvider = undefined,
}) {
  const loginLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 15 });

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const authCtx = getAuthenticatedContext({ db, config, req });

    try {
      // --- Health & Integration Status ---
      if (req.method === 'GET' && pathname === '/api/health') {
        const dbRow = db.prepare('SELECT 1 AS ok').get();
        return sendJson(res, 200, {
          status: 'operational',
          database: { engine: 'sqlite', status: dbRow?.ok === 1 ? 'connected' : 'error' },
          detectifai: getDetectifAiConfigStatus(),
          githubAppConfigured: Boolean(config.github.appId),
          webauthnRpId: config.webauthn.rpId,
        });
      }

      if (req.method === 'GET' && pathname === '/api/integrations') {
        const detectif = getDetectifAiConfigStatus();
        const ghStatus = getGitHubIntegrationStatus(db, config);
        return sendJson(res, 200, {
          mode: 'live',
          detectifai: {
            status: detectif.configured ? 'CONNECTED' : 'ERROR',
            configured: detectif.configured,
            baseUrl: detectif.baseUrl,
          },
          github: {
            status: ghStatus.configured ? 'CONNECTED' : 'DISCONNECTED',
            configured: ghStatus.configured,
            webhookSecretConfigured: ghStatus.webhookSecretConfigured,
            webhookDeliveryCount: ghStatus.webhookDeliveryCount,
            lastActivity: ghStatus.lastActivity,
          },
          webauthn: {
            status: 'ENFORCED',
            rpId: config.webauthn.rpId,
          },
        });
      }

      // --- Phase 1: Auth, Sessions & Demo Identities ---
      if (req.method === 'GET' && pathname === '/api/auth/demo-accounts') {
        return sendJson(res, 200, { accounts: listDemoAccounts(db) });
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const clientKey = req.socket?.remoteAddress || 'unknown';
        loginLimiter(clientKey);
        const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
        const session = loginWithPassword({
          db,
          config,
          email: body.email,
          password: body.password,
          ipAddress: clientKey,
          userAgent: req.headers['user-agent'] || null,
        });
        logger.info('User authenticated', { userId: session.user.id, sessionId: session.sessionId });
        return sendJson(
          res,
          200,
          {
            user: session.user,
            organisation: session.organisation,
            expiresAt: session.expiresAt,
          },
          {
            'Set-Cookie': buildSessionCookieHeader(session.rawToken, config, config.sessionTtlSeconds),
          },
        );
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        const cookies = parseCookies(req);
        logoutSession({ db, config, rawToken: cookies[config.sessionCookieName] });
        return sendJson(
          res,
          200,
          { loggedOut: true },
          {
            'Set-Cookie': buildSessionCookieHeader('', config, 0),
          },
        );
      }

      if (req.method === 'GET' && pathname === '/api/auth/me') {
        const ctx = requireAuth(authCtx);
        return sendJson(res, 200, {
          user: ctx.user,
          organisation: ctx.organisation,
          sessionId: ctx.sessionId,
        });
      }

      if (req.method === 'GET' && pathname === '/api/dashboard/summary') {
        const ctx = requirePermission(authCtx, 'action:read');
        return sendJson(res, 200, getDashboardSummary(db, config, ctx.organisation.id));
      }

      // --- Phase 1: Organisation & RBAC ---
      if (req.method === 'GET' && pathname === '/api/org') {
        const ctx = requirePermission(authCtx, 'org:read');
        const details = getOrganisationDetails(db, ctx.organisation.id);
        if (!details) throw new NotFoundError('Organisation not found');
        return sendJson(res, 200, details);
      }

      if (req.method === 'GET' && pathname === '/api/rbac/check') {
        const ctx = requireAuth(authCtx);
        const permission = url.searchParams.get('permission') || '';
        if (!permission) throw new ValidationError('permission query parameter is required');
        requirePermission(ctx, permission);
        return sendJson(res, 200, { allowed: true, permission, userId: ctx.user.id });
      }

      // --- Phase 2: Action Envelope & Authorization Lifecycle ---
      if (req.method === 'GET' && pathname === '/api/actions') {
        const ctx = requirePermission(authCtx, 'action:read');
        const stateFilter = url.searchParams.get('state') || undefined;
        const categoryFilter = url.searchParams.get('category') || undefined;
        const actions = listActionRequests(db, ctx.organisation.id, {
          state: stateFilter,
          category: categoryFilter,
        });
        return sendJson(res, 200, { actions });
      }

      if (req.method === 'POST' && pathname === '/api/actions') {
        const ctx = requirePermission(authCtx, 'action:create');
        const body = parseJsonBuffer(await readRawBody(req));
        const action = createActionRequest({ db, authCtx: ctx, input: body });
        return sendJson(res, 201, { action });
      }

      const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)(?:\/(.+))?$/);
      if (actionMatch) {
        const actionId = decodeURIComponent(actionMatch[1]);
        const sub = actionMatch[2] || '';

        if (!sub && req.method === 'GET') {
          const ctx = requirePermission(authCtx, 'action:read');
          const action = getActionRequestDetail(db, ctx.organisation.id, actionId);
          return sendJson(res, 200, { action });
        }

        if (sub === 'versions' && req.method === 'GET') {
          const ctx = requirePermission(authCtx, 'action:read');
          const action = getActionRequestDetail(db, ctx.organisation.id, actionId);
          return sendJson(res, 200, { versions: action.versions });
        }

        if (sub === 'mutate' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:create');
          const body = parseJsonBuffer(await readRawBody(req));
          const result = mutateActionEnvelope({
            db,
            authCtx: ctx,
            actionRequestId: actionId,
            updatedParameters: body.parameters,
            reason: body.reason || 'Material action parameters updated',
          });
          return sendJson(res, 200, result);
        }

        if (sub === 'verify-hash' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:read');
          getActionRequestDetail(db, ctx.organisation.id, actionId);
          const body = parseJsonBuffer(await readRawBody(req));
          const check = verifyLatestEnvelopeIntegrity(db, actionId, body.expectedActionHash || null);
          return sendJson(res, check.valid ? 200 : 409, {
            valid: check.valid,
            reason: check.reason || 'HASH_MATCH',
            storedHash: check.envelope.action_hash,
            recomputedHash: check.recomputed,
          });
        }

        if (sub === 'reject' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:reject');
          const body = parseJsonBuffer(await readRawBody(req));
          const transition = rejectActionRequest({
            db,
            authCtx: ctx,
            actionRequestId: actionId,
            reason: body.reason || 'Explicitly rejected by approver',
          });
          return sendJson(res, 200, { state: transition.toState, transition });
        }

        // Phase 4: Dynamic Voice Challenge, Server STT & Combined DetectifAI Verification
        if (sub === 'challenge' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:challenge');
          const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
          const challenge = issueVoiceChallenge({
            db,
            authCtx: ctx,
            actionRequestId: actionId,
            ttlSeconds: body.ttlSeconds,
          });
          return sendJson(res, 201, { challenge });
        }

        if (sub === 'recording' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:verify_voice');
          const body = parseJsonBuffer(await readRawBody(req, 35 * 1024 * 1024));
          const outcome = await submitVoiceChallengeRecording(
            { db, config, authCtx: ctx, actionRequestId: actionId, input: body },
            {
              ...(sttProvider ? { sttProvider } : {}),
              ...(verifyProvider ? { verifyProvider } : {}),
            },
          );
          const status = outcome.providerError ? 503 : 200;
          return sendJson(res, status, outcome);
        }

        if (sub === 'verification' && req.method === 'GET') {
          const ctx = requirePermission(authCtx, 'action:read');
          const summary = getVerificationSummary(db, ctx.organisation.id, actionId);
          return sendJson(res, 200, summary);
        }

        if (sub === 'policy-eval' && req.method === 'GET') {
          const ctx = requirePermission(authCtx, 'action:read');
          const evalResult = evaluateActionPolicy({ db, actionRequestId: actionId, actingUser: ctx.user });
          return sendJson(res, 200, evalResult);
        }

        if (sub === 'passkey/options' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:approve');
          const options = await startActionPasskeyAuth({ db, config, authCtx: ctx, actionRequestId: actionId });
          return sendJson(res, 200, options);
        }

        if (sub === 'passkey/verify' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:approve');
          const body = parseJsonBuffer(await readRawBody(req, 256 * 1024));
          const result = await finishActionPasskeyAuth(
            { db, config, authCtx: ctx, actionRequestId: actionId, response: body.response || body },
            webauthnProvider?.verifyAuthentication ? { verifyAuthentication: webauthnProvider.verifyAuthentication } : undefined,
          );
          return sendJson(res, 200, result);
        }

        if (sub === 'peer-approve' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:approve');
          const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
          const result = recordPeerApproval({
            db,
            authCtx: ctx,
            actionRequestId: actionId,
            decision: body.decision || 'APPROVED',
            reason: body.reason || '',
          });
          return sendJson(res, 200, result);
        }

        if (sub === 'approve' && req.method === 'POST') {
          const ctx = requirePermission(authCtx, 'action:approve');
          const permit = issueScopedPermitToken({ db, config, authCtx: ctx, actionRequestId: actionId });
          return sendJson(res, 200, { state: 'TOKEN_ISSUED', permit });
        }

        if (sub === 'github-callback' && req.method === 'POST') {
          const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
          const decision = body.decision === 'rejected' ? 'rejected' : 'approved';
          const ctx = requirePermission(authCtx, decision === 'rejected' ? 'action:reject' : 'action:approve');
          const callbackResult = await executeGitHubDeploymentCallback(
            {
              db,
              config,
              authCtx: ctx,
              actionRequestId: actionId,
              decision,
              permitToken: body.permitToken || body.token || '',
              installationId: body.installationId || null,
              comment: body.comment || '',
            },
            githubProvider || undefined,
          );
          return sendJson(res, 200, callbackResult);
        }
      }

      if (req.method === 'POST' && pathname === '/api/webhooks/github') {
        const rawBody = await readRawBody(req);
        const result = ingestGitHubWebhook({
          db,
          config,
          headers: req.headers,
          rawBody,
        });
        return sendJson(res, result.status, result.body);
      }

      if (req.method === 'POST' && pathname === '/api/webhooks/detectifai') {
        const rawBody = await readRawBody(req);
        const result = ingestDetectifAiWebhook({
          db,
          config,
          headers: req.headers,
          rawBody,
          scheduleAsync: true,
        });
        return sendJson(res, result.status, result.body);
      }

      if (req.method === 'GET' && pathname === '/api/webhooks/events') {
        requirePermission(authCtx, 'audit:read');
        return sendJson(res, 200, { events: listWebhookEvents(db) });
      }

      if (req.method === 'GET' && pathname === '/api/audit-events') {
        const ctx = requirePermission(authCtx, 'audit:read');
        return sendJson(res, 200, { events: listAuditEvents(db, ctx.organisation.id) });
      }

      if (req.method === 'GET' && pathname === '/api/audit-events/verify-chain') {
        const ctx = requirePermission(authCtx, 'audit:read');
        return sendJson(res, 200, verifyAuditChain(db, ctx.organisation.id));
      }

      // --- Phase 9: Security Incidents & Break-Glass Emergency Registry ---
      if (req.method === 'GET' && pathname === '/api/incidents') {
        const ctx = requirePermission(authCtx, 'action:read');
        return sendJson(res, 200, { incidents: listIncidents(db, ctx.organisation.id) });
      }

      const incidentMatch = pathname.match(/^\/api\/incidents\/([^/]+)$/);
      if (incidentMatch && req.method === 'PATCH') {
        const ctx = requirePermission(authCtx, 'incident:manage');
        const incidentId = decodeURIComponent(incidentMatch[1]);
        const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
        const incident = updateIncidentStatus({
          db,
          authCtx: ctx,
          incidentId,
          status: body.status,
          note: body.note || '',
        });
        return sendJson(res, 200, { incident });
      }

      if (req.method === 'GET' && pathname === '/api/break-glass') {
        const ctx = requirePermission(authCtx, 'audit:read');
        return sendJson(res, 200, { events: listBreakGlassEvents(db, ctx.organisation.id) });
      }

      if (req.method === 'POST' && pathname === '/api/break-glass') {
        const ctx = requirePermission(authCtx, 'incident:manage');
        const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
        const event = createBreakGlassEvent({ db, authCtx: ctx, input: body });
        return sendJson(res, 201, { event });
      }

      // --- Phase 3: Voice Registry, Enrollment & Consent ---
      if (req.method === 'GET' && pathname === '/api/speakers') {
        const ctx = requirePermission(authCtx, 'action:read');
        return sendJson(res, 200, { speakers: listSpeakerProfiles(db, ctx.organisation.id) });
      }

      if (req.method === 'POST' && pathname === '/api/speakers/enroll') {
        const ctx = requirePermission(authCtx, 'speaker:enroll');
        const body = parseJsonBuffer(await readRawBody(req, 35 * 1024 * 1024));
        const speaker = await enrollSpeakerProfile(
          { db, authCtx: ctx, input: body },
          speakerProvider?.enroll ? { enrollProvider: speakerProvider.enroll } : undefined,
        );
        return sendJson(res, 201, { speaker });
      }

      const opRecoverMatch = pathname.match(/^\/api\/operations\/([^/]+)\/recover$/);
      if (opRecoverMatch && req.method === 'POST') {
        const ctx = requirePermission(authCtx, 'action:verify_voice');
        const operationId = decodeURIComponent(opRecoverMatch[1]);
        const recovered = await recoverDetectifAiOperation(
          { db, authCtx: ctx, operationId },
          fetchOperationProvider ? { fetchOperationProvider } : undefined,
        );
        return sendJson(res, recovered.recovered ? 200 : 503, recovered);
      }

      // --- Phase 6: Security Policies, WebAuthn Registration & Scoped Token Consumption ---
      if (req.method === 'GET' && pathname === '/api/policies') {
        const ctx = requirePermission(authCtx, 'action:read');
        return sendJson(res, 200, { policies: listPolicies(db, ctx.organisation.id) });
      }

      if (req.method === 'POST' && pathname === '/api/policies') {
        const ctx = requirePermission(authCtx, 'policy:manage');
        const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
        const policy = createPolicy({ db, authCtx: ctx, input: body });
        return sendJson(res, 201, { policy });
      }

      const policyMatch = pathname.match(/^\/api\/policies\/([^/]+)$/);
      if (policyMatch && req.method === 'PATCH') {
        const ctx = requirePermission(authCtx, 'policy:manage');
        const policyId = decodeURIComponent(policyMatch[1]);
        const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
        const policy = updatePolicy({ db, authCtx: ctx, policyId, input: body });
        return sendJson(res, 200, { policy });
      }

      if (req.method === 'POST' && pathname === '/api/webauthn/register/options') {
        const ctx = requirePermission(authCtx, 'passkey:register');
        const options = await startPasskeyRegistration({ db, config, authCtx: ctx });
        return sendJson(res, 200, options);
      }

      if (req.method === 'POST' && pathname === '/api/webauthn/register/verify') {
        const ctx = requirePermission(authCtx, 'passkey:register');
        const body = parseJsonBuffer(await readRawBody(req, 256 * 1024));
        const resReg = await finishPasskeyRegistration(
          { db, config, authCtx: ctx, response: body.response || body },
          webauthnProvider?.verifyRegistration ? { verifyRegistration: webauthnProvider.verifyRegistration } : undefined,
        );
        return sendJson(res, 201, resReg);
      }

      if (req.method === 'POST' && pathname === '/api/tokens/consume') {
        const body = parseJsonBuffer(await readRawBody(req, 64 * 1024));
        const consumed = consumeScopedPermitToken({
          db,
          config,
          rawToken: body.token,
          expectedActionId: body.expectedActionId,
          expectedScope: body.expectedScope,
          expectedTargetIntegration: body.expectedTargetIntegration,
          expectedEnvironment: body.expectedEnvironment,
        });
        return sendJson(res, 200, consumed);
      }

      const speakerDeleteMatch = pathname.match(/^\/api\/speakers\/([^/]+)$/);
      if (speakerDeleteMatch && req.method === 'DELETE') {
        const ctx = requirePermission(authCtx, 'speaker:delete');
        const speakerId = decodeURIComponent(speakerDeleteMatch[1]);
        const result = await deleteSpeakerProfile(
          { db, authCtx: ctx, speakerId },
          speakerProvider?.remove ? { deleteProvider: speakerProvider.remove } : undefined,
        );
        return sendJson(res, 200, result);
      }

      throw new NotFoundError('Endpoint not found');
    } catch (err) {
      const { status, body } = toSafeErrorPayload(err);
      const extraHeaders = err?.retryAfterSec ? { 'Retry-After': String(err.retryAfterSec) } : {};
      if (status >= 500) {
        logger.error('Unhandled request error', { method: req.method, path: pathname, err: err?.message });
      } else {
        logger.warn('Request rejected', { method: req.method, path: pathname, status, code: body.error.code });
      }
      return sendJson(res, status, body, extraHeaders);
    } finally {
      logger.info('HTTP request', {
        method: req.method,
        path: pathname,
        durationMs: Date.now() - started,
      });
    }
  });
}
