import crypto from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { evaluateActionPolicy, findMatchingPolicy } from './policyEngineService.mjs';
import { ACTION_STATES, transitionActionState, verifyLatestEnvelopeIntegrity } from './stateMachine.mjs';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const pendingChallenges = new Map();

function storeChallenge(key, challenge, extra = {}) {
  pendingChallenges.set(key, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    ...extra,
  });
}

function consumeChallenge(key) {
  const entry = pendingChallenges.get(key);
  pendingChallenges.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    throw new ConflictError('WebAuthn challenge missing or expired; request fresh options');
  }
  return entry;
}

function getUserCredentials(db, userId) {
  return db
    .prepare('SELECT * FROM passkey_credentials WHERE user_id = ?')
    .all(userId)
    .map((row) => ({
      id: row.credential_id,
      publicKey: new Uint8Array(Buffer.from(row.public_key_b64, 'base64')),
      counter: row.counter,
      transports: row.transports_json ? JSON.parse(row.transports_json) : undefined,
    }));
}

export async function startPasskeyRegistration({ db, config, authCtx }) {
  const existing = getUserCredentials(db, authCtx.user.id);
  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: config.webauthn.rpId,
    userName: authCtx.user.email,
    userDisplayName: authCtx.user.displayName,
    userID: Buffer.from(authCtx.user.id, 'utf8'),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  storeChallenge(`reg:${authCtx.user.id}`, options.challenge);
  return options;
}

export async function finishPasskeyRegistration(
  { db, config, authCtx, response },
  { verifyRegistration = verifyRegistrationResponse } = {},
) {
  if (!response || typeof response !== 'object') {
    throw new ValidationError('WebAuthn registration response is required');
  }
  const { challenge } = consumeChallenge(`reg:${authCtx.user.id}`);

  let verification;
  try {
    verification = await verifyRegistration({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new ValidationError(`WebAuthn registration failed: ${err instanceof Error ? err.message : 'invalid response'}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new ValidationError('WebAuthn registration assertion could not be verified');
  }

  const { credential } = verification.registrationInfo;
  const now = new Date().toISOString();
  const rowId = `pkc_${crypto.randomBytes(6).toString('hex')}`;
  const publicKeyB64 = Buffer.from(credential.publicKey).toString('base64');

  db.prepare(
    `INSERT INTO passkey_credentials
      (id, user_id, credential_id, public_key_b64, counter, transports_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rowId,
    authCtx.user.id,
    credential.id,
    publicKeyB64,
    credential.counter || 0,
    JSON.stringify(credential.transports || []),
    now,
  );

  recordAuditEvent({
    db,
    organisationId: authCtx.organisation.id,
    actorUserId: authCtx.user.id,
    eventType: 'PASSKEY_REGISTERED',
    payload: { credentialId: credential.id, aaguid: verification.registrationInfo.aaguid || null },
  });

  return { verified: true, credentialId: credential.id, createdAt: now };
}

export async function startActionPasskeyAuth({ db, config, authCtx, actionRequestId }) {
  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!action) throw new NotFoundError(`Action request ${actionRequestId} not found`);
  if (action.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Requester cannot perform WebAuthn approval for own request');
  }

  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId);
  if (!integrity.valid) {
    throw new ConflictError(`Cannot start passkey step-up: ${integrity.reason}`);
  }

  const policy = findMatchingPolicy(db, action.organisation_id, action.category);
  const policyEval = evaluateActionPolicy({ db, actionRequestId, actingUser: authCtx.user });
  if (policy?.require_voice && !policyEval.checks.voicePassed) {
    throw new ConflictError('Voice verification stage must pass before hardware passkey step-up');
  }

  const creds = getUserCredentials(db, authCtx.user.id);
  if (creds.length === 0) {
    throw new ConflictError('No WebAuthn passkey registered for authenticated approver');
  }

  const options = await generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: 'required',
  });

  if (action.current_state === ACTION_STATES.VOICE_VERIFIED || action.current_state === ACTION_STATES.HOLD) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.WAITING_FOR_PASSKEY,
      actorUserId: authCtx.user.id,
      reason: 'WebAuthn authentication challenge issued',
      expectedActionHash: integrity.envelope.action_hash,
    });
  }

  storeChallenge(`auth:${actionRequestId}:${authCtx.user.id}`, options.challenge, {
    actionHash: integrity.envelope.action_hash,
  });

  return options;
}

export async function finishActionPasskeyAuth(
  { db, config, authCtx, actionRequestId, response },
  { verifyAuthentication = verifyAuthenticationResponse } = {},
) {
  if (!response || typeof response !== 'object') {
    throw new ValidationError('WebAuthn authentication response is required');
  }

  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);
  if (!action) throw new NotFoundError(`Action request ${actionRequestId} not found`);
  if (action.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Requester cannot verify passkey for own request');
  }

  const { challenge, actionHash } = consumeChallenge(`auth:${actionRequestId}:${authCtx.user.id}`);

  // Recompute and confirm action hash hasn't changed while prompt was open
  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId, actionHash);
  if (!integrity.valid) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `Action hash changed during WebAuthn step-up (${integrity.reason})`,
      skipIntegrityCheck: true,
    });
    throw new ConflictError('Action parameters changed during passkey assertion; action returned to HOLD');
  }

  const creds = getUserCredentials(db, authCtx.user.id);
  const matchingCred = creds.find((c) => c.id === response.id);
  if (!matchingCred) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: 'WebAuthn credential does not belong to authenticated approver',
      skipIntegrityCheck: true,
    });
    throw new ForbiddenError('WebAuthn credential ownership mismatch');
  }

  let verification;
  try {
    verification = await verifyAuthentication({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      credential: matchingCred,
      requireUserVerification: true,
    });
  } catch (err) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `WebAuthn verification error: ${err instanceof Error ? err.message : 'invalid assertion'}`,
      skipIntegrityCheck: true,
    });
    throw new ValidationError(`WebAuthn assertion rejected: ${err instanceof Error ? err.message : 'invalid signature'}`);
  }

  if (!verification.verified || !verification.authenticationInfo) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: 'WebAuthn assertion verified=false',
      skipIntegrityCheck: true,
    });
    throw new ValidationError('WebAuthn assertion could not be verified');
  }

  const { newCounter } = verification.authenticationInfo;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?').run(
      newCounter,
      now,
      matchingCred.id,
    );

    db.prepare(
      `INSERT INTO approvals (id, action_request_id, approver_user_id, approval_kind, decision, action_hash, reason, created_at)
       VALUES (?, ?, ?, 'PASSKEY', 'APPROVED', ?, 'Server-verified WebAuthn assertion', ?)`,
    ).run(`apr_${crypto.randomBytes(6).toString('hex')}`, actionRequestId, authCtx.user.id, actionHash, now);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const policyEval = evaluateActionPolicy({ db, actionRequestId, actingUser: authCtx.user });
  const nextState = policyEval.decision === 'ALLOW_RELEASE' ? ACTION_STATES.APPROVED : ACTION_STATES.WAITING_FOR_PEER_APPROVAL;

  transitionActionState({
    db,
    actionRequestId,
    toState: nextState,
    actorUserId: authCtx.user.id,
    reason:
      nextState === ACTION_STATES.APPROVED
        ? 'Passkey verified and all policy factors satisfied'
        : 'Passkey verified; awaiting independent peer approval',
    metadata: { credentialId: matchingCred.id, newCounter },
    expectedActionHash: actionHash,
  });

  return {
    verified: true,
    state: nextState,
    newCounter,
    policyEvaluation: policyEval,
  };
}
