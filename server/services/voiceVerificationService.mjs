import crypto from 'node:crypto';
import { fetchDetectifAiOperation, parseDetectifAiVerifyResponse, verifySpeakerWithDetectifAi } from '../detectifai.mjs';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { ALLOWED_AUDIO_MIME_TYPES } from './speakerRegistryService.mjs';
import { ACTION_STATES, transitionActionState, verifyLatestEnvelopeIntegrity } from './stateMachine.mjs';
import { compareChallengePhrase, transcribeWithGoogleSttV2 } from './sttService.mjs';

const MAX_CHALLENGE_AUDIO_BYTES = 25 * 1024 * 1024;

function extractRequiredPhraseTokens(phrase) {
  const wordsMatch = phrase.match(/Challenge words ([a-z\s]+) code ([A-F0-9-]+)/i);
  if (!wordsMatch) return [];
  const challengeWords = wordsMatch[1].trim().split(/\s+/);
  const nonceParts = wordsMatch[2].trim().split('-');
  return [...challengeWords, ...nonceParts];
}

function recordSecurityIncident({ db, organisationId, actionRequestId, severity, title, reason }) {
  const now = new Date().toISOString();
  const id = `inc_${crypto.randomBytes(5).toString('hex')}`;
  db.prepare(
    `INSERT INTO security_incidents
      (id, organisation_id, action_request_id, severity, title, reason, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
  ).run(id, organisationId, actionRequestId, severity, title, reason, now, now);
  return id;
}

function upsertModelOperation({ db, actionRequestId, challengeId, operationId, operationType, status, rawResponse, errorCode }) {
  if (!operationId) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO model_operations
      (id, action_request_id, challenge_id, provider, operation_id, operation_type, status, raw_response_json, error_code, created_at, updated_at)
     VALUES (
       COALESCE((SELECT id FROM model_operations WHERE operation_id = ?), ?),
       ?, ?, 'detectifai', ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM model_operations WHERE operation_id = ?), ?), ?
     )`,
  ).run(
    operationId,
    `mop_${crypto.randomBytes(6).toString('hex')}`,
    actionRequestId,
    challengeId,
    operationId,
    operationType,
    status,
    rawResponse ? JSON.stringify(rawResponse) : null,
    errorCode || null,
    operationId,
    now,
    now,
  );
}

export async function submitVoiceChallengeRecording(
  { db, config, authCtx, actionRequestId, input },
  { sttProvider = transcribeWithGoogleSttV2, verifyProvider = verifySpeakerWithDetectifAi } = {},
) {
  const action = db
    .prepare('SELECT * FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, authCtx.organisation.id);

  if (!action) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }
  if (action.requester_user_id === authCtx.user.id) {
    throw new ForbiddenError('Separation of duties violation: requester cannot submit voice verification for own request');
  }

  const challengeId = input.challengeId;
  const challenge = challengeId
    ? db.prepare('SELECT * FROM voice_challenges WHERE id = ? AND action_request_id = ?').get(challengeId, actionRequestId)
    : db
        .prepare('SELECT * FROM voice_challenges WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(actionRequestId);

  if (!challenge) {
    throw new NotFoundError('No voice challenge found for this action request');
  }
  if (challenge.consumed_at) {
    throw new ConflictError('Voice challenge has already been consumed or invalidated; issue a fresh challenge');
  }
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: 'Voice challenge expired before submission',
      skipIntegrityCheck: true,
    });
    throw new ConflictError('Voice challenge expired; issue a fresh challenge');
  }

  // Verify envelope hash hasn't drifted since challenge issuance
  const integrity = verifyLatestEnvelopeIntegrity(db, actionRequestId, challenge.action_hash);
  if (!integrity.valid) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `Action hash changed since challenge issuance (${integrity.reason})`,
      skipIntegrityCheck: true,
    });
    throw new ConflictError('Action parameters changed after challenge issuance; verification invalidated');
  }

  // Validate uploaded audio recording
  const cleanMime = String(input.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIME_TYPES.has(cleanMime)) {
    throw new ValidationError(`Unsupported audio MIME type: ${input.mimeType || 'unknown'}`);
  }
  if (!input.audioBase64 || typeof input.audioBase64 !== 'string') {
    throw new ValidationError('audioBase64 recording payload is required');
  }
  const audioBuffer = Buffer.from(input.audioBase64, 'base64');
  if (audioBuffer.length < 1024) {
    throw new ValidationError('Audio recording too small or empty');
  }
  if (audioBuffer.length > MAX_CHALLENGE_AUDIO_BYTES) {
    throw new ValidationError('Audio recording exceeds 25 MB limit');
  }

  const approverId = challenge.designated_approver_id || authCtx.user.id;
  const speakerProfile = db
    .prepare("SELECT * FROM speaker_profiles WHERE user_id = ? AND status = 'ENROLLED' AND deleted_at IS NULL")
    .get(approverId);

  if (!speakerProfile) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: 'Designated approver does not have an active enrolled DetectifAI speaker profile',
      expectedActionHash: challenge.action_hash,
    });
    throw new ConflictError('Designated approver has no active enrolled voice profile');
  }

  // Atomically mark challenge consumed so it can never be replayed
  const nowIso = new Date().toISOString();
  const updateResult = db
    .prepare('UPDATE voice_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .run(nowIso, challenge.id);
  if (updateResult.changes !== 1) {
    throw new ConflictError('Challenge already consumed concurrently');
  }

  transitionActionState({
    db,
    actionRequestId,
    toState: ACTION_STATES.VOICE_CHECK_PENDING,
    actorUserId: authCtx.user.id,
    reason: 'Submitting same challenge recording to STT and DetectifAI',
    expectedActionHash: challenge.action_hash,
  });

  // 1. Server-side Speech-to-Text phrase validation (ignores any client-provided transcript)
  const sttRes = await sttProvider({ audioBuffer, mimeType: cleanMime, config });
  if (!sttRes.ok) {
    db.prepare('UPDATE voice_challenges SET stt_status = ? WHERE id = ?').run(sttRes.code || 'UNAVAILABLE', challenge.id);
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `STT unavailable or failed (${sttRes.code}); manual verification required`,
      metadata: { sttCode: sttRes.code },
      skipIntegrityCheck: true,
    });
    return {
      state: ACTION_STATES.HOLD,
      stt: { status: sttRes.code, matched: false, message: sttRes.message },
      eidos: null,
      aletheia: null,
    };
  }

  const requiredTokens = extractRequiredPhraseTokens(challenge.phrase);
  const phraseCheck = compareChallengePhrase(challenge.phrase, sttRes.transcript, requiredTokens);
  db.prepare('UPDATE voice_challenges SET stt_status = ?, stt_transcript = ? WHERE id = ?').run(
    phraseCheck.matched ? 'MATCHED' : 'MISMATCH',
    sttRes.transcript,
    challenge.id,
  );

  if (!phraseCheck.matched) {
    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: 'Spoken challenge phrase did not match expected nonce/words',
      metadata: { coverage: phraseCheck.coverage, missingRequired: phraseCheck.missingRequired },
      skipIntegrityCheck: true,
    });
    return {
      state: ACTION_STATES.HOLD,
      stt: { status: 'MISMATCH', matched: false, transcript: sttRes.transcript, coverage: phraseCheck.coverage },
      eidos: null,
      aletheia: null,
    };
  }

  // 2. Single combined DetectifAI call on the SAME recording: POST /v1/speakers/verify?detect_deepfake=true
  const idempotencyKey = input.idempotencyKey || `vrf_${challenge.id}`;
  const verifyRes = await verifyProvider({
    audioBuffer,
    mimeType: cleanMime,
    speakerId: speakerProfile.detectifai_speaker_id,
    detectDeepfake: true,
    idempotencyKey,
  });

  const verificationId = `vrf_${crypto.randomBytes(6).toString('hex')}`;
  const vNow = new Date().toISOString();

  if (!verifyRes.ok) {
    db.prepare(
      `INSERT INTO voice_verifications
        (id, action_request_id, challenge_id, evidence_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(verificationId, actionRequestId, challenge.id, verifyRes.code || 'PROVIDER_ERROR', vNow, vNow);

    transitionActionState({
      db,
      actionRequestId,
      toState: ACTION_STATES.HOLD,
      actorUserId: authCtx.user.id,
      reason: `DetectifAI verification did not complete (${verifyRes.code})`,
      metadata: { errorCode: verifyRes.code },
      skipIntegrityCheck: true,
    });

    return {
      state: ACTION_STATES.HOLD,
      stt: { status: 'MATCHED', matched: true, transcript: sttRes.transcript },
      providerError: { code: verifyRes.code, message: verifyRes.message, retryAfterSeconds: verifyRes.retryAfterSeconds },
      eidos: null,
      aletheia: null,
    };
  }

  const parsed = verifyRes.parsed || parseDetectifAiVerifyResponse(verifyRes.data);

  upsertModelOperation({
    db,
    actionRequestId,
    challengeId: challenge.id,
    operationId: parsed.eidos.operationId,
    operationType: 'speaker.verify',
    status: parsed.eidos.decision ? 'SUCCEEDED' : 'PENDING',
    rawResponse: verifyRes.data,
    errorCode: null,
  });

  if (parsed.aletheia.operationId) {
    upsertModelOperation({
      db,
      actionRequestId,
      challengeId: challenge.id,
      operationId: parsed.aletheia.operationId,
      operationType: 'deepfake.detect',
      status: parsed.aletheia.error ? 'FAILED' : parsed.aletheia.verdict ? 'SUCCEEDED' : 'PENDING',
      rawResponse: parsed.raw?.deepfake || null,
      errorCode: parsed.aletheia.error?.code || (parsed.aletheia.error ? 'ALETHEIA_ERROR' : null),
    });
  }

  let evidenceStatus = 'PARTIAL';
  let nextState = ACTION_STATES.HOLD;
  let transitionReason = 'Incomplete or partial AI verification result; holding action';

  if (parsed.completeness === 'COMPLETE') {
    if (parsed.aletheia.verdict === 'fake') {
      evidenceStatus = 'ALETHEIA_FAKE';
      nextState = ACTION_STATES.HOLD;
      transitionReason = 'Aletheia returned verdict=fake; held regardless of Eidos decision';
      recordSecurityIncident({
        db,
        organisationId: authCtx.organisation.id,
        actionRequestId,
        severity: 'SEV-1 CRITICAL',
        title: 'Synthetic speech suspected (Aletheia verdict: fake)',
        reason: `Aletheia score=${parsed.aletheia.score}, Eidos decision=${parsed.eidos.decision}`,
      });
    } else if (parsed.eidos.decision === 'no_match') {
      evidenceStatus = 'EIDOS_NO_MATCH';
      nextState = ACTION_STATES.HOLD;
      transitionReason = 'Eidos returned decision=no_match; speaker did not match enrolled profile';
    } else if (parsed.aletheia.verdict === 'real' && parsed.eidos.decision === 'match') {
      evidenceStatus = 'DUAL_VERIFIED';
      nextState = ACTION_STATES.VOICE_VERIFIED;
      transitionReason = 'STT matched + Eidos match + Aletheia real (evidence only; step-up still required)';
    }
  }

  db.prepare(
    `INSERT INTO voice_verifications
      (id, action_request_id, challenge_id, eidos_operation_id, eidos_decision, eidos_similarity, aletheia_operation_id, aletheia_verdict, aletheia_score, evidence_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    verificationId,
    actionRequestId,
    challenge.id,
    parsed.eidos.operationId,
    parsed.eidos.decision,
    parsed.eidos.similarity,
    parsed.aletheia.operationId,
    parsed.aletheia.verdict,
    parsed.aletheia.score,
    evidenceStatus,
    vNow,
    vNow,
  );

  transitionActionState({
    db,
    actionRequestId,
    toState: nextState,
    actorUserId: authCtx.user.id,
    reason: transitionReason,
    metadata: {
      verificationId,
      evidenceStatus,
      eidosOperationId: parsed.eidos.operationId,
      aletheiaOperationId: parsed.aletheia.operationId,
    },
    expectedActionHash: challenge.action_hash,
  });

  return getVerificationSummary(db, authCtx.organisation.id, actionRequestId);
}

export async function recoverDetectifAiOperation(
  { db, authCtx, operationId },
  { fetchOperationProvider = fetchDetectifAiOperation } = {},
) {
  const opRow = db
    .prepare(
      `SELECT mo.*, ar.organisation_id
       FROM model_operations mo
       LEFT JOIN action_requests ar ON ar.id = mo.action_request_id
       WHERE mo.operation_id = ?`,
    )
    .get(operationId);

  const remote = await fetchOperationProvider(operationId);
  if (!remote.ok) {
    return { recovered: false, code: remote.code, message: remote.message };
  }

  const now = new Date().toISOString();
  const status = String(remote.status || 'pending').toUpperCase();
  if (opRow) {
    db.prepare(
      `UPDATE model_operations SET status = ?, raw_response_json = ?, error_code = ?, updated_at = ? WHERE operation_id = ?`,
    ).run(
      status,
      JSON.stringify(remote.data),
      remote.error?.code || null,
      now,
      operationId,
    );

    if (opRow.action_request_id && remote.status === 'succeeded' && remote.result) {
      const verification = db
        .prepare('SELECT * FROM voice_verifications WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(opRow.action_request_id);

      if (verification) {
        if (remote.type === 'deepfake.detect') {
          const verdict = remote.result.verdict || null;
          const score = typeof remote.result.score === 'number' ? remote.result.score : null;
          db.prepare(
            `UPDATE voice_verifications SET aletheia_verdict = ?, aletheia_score = ?, updated_at = ? WHERE id = ?`,
          ).run(verdict, score, now, verification.id);
        } else if (remote.type === 'speaker.verify') {
          const decision = remote.result.decision || null;
          const similarity = typeof remote.result.similarity === 'number' ? remote.result.similarity : null;
          db.prepare(
            `UPDATE voice_verifications SET eidos_decision = ?, eidos_similarity = ?, updated_at = ? WHERE id = ?`,
          ).run(decision, similarity, now, verification.id);
        }

        const refreshed = db.prepare('SELECT * FROM voice_verifications WHERE id = ?').get(verification.id);
        if (refreshed.eidos_decision === 'match' && refreshed.aletheia_verdict === 'real') {
          db.prepare("UPDATE voice_verifications SET evidence_status = 'DUAL_VERIFIED', updated_at = ? WHERE id = ?").run(
            now,
            verification.id,
          );
          const action = db.prepare('SELECT current_state FROM action_requests WHERE id = ?').get(opRow.action_request_id);
          if (action && ['VOICE_CHECK_PENDING', 'HOLD'].includes(action.current_state)) {
            transitionActionState({
              db,
              actionRequestId: opRow.action_request_id,
              toState: ACTION_STATES.VOICE_VERIFIED,
              actorUserId: authCtx?.user?.id || null,
              reason: `Operation ${operationId} recovered via GET /v1/operations`,
            });
          }
        }
      }
    }

    if (opRow.organisation_id) {
      recordAuditEvent({
        db,
        organisationId: opRow.organisation_id,
        actionRequestId: opRow.action_request_id,
        actorUserId: authCtx?.user?.id || null,
        eventType: 'OPERATION_RECOVERED',
        payload: { operationId, status },
      });
    }
  }

  return {
    recovered: true,
    operationId,
    status: remote.status,
    type: remote.type,
    result: remote.result,
    error: remote.error,
  };
}

export function getVerificationSummary(db, organisationId, actionRequestId) {
  const action = db
    .prepare('SELECT id, current_state, current_version FROM action_requests WHERE id = ? AND organisation_id = ?')
    .get(actionRequestId, organisationId);
  if (!action) {
    throw new NotFoundError(`Action request ${actionRequestId} not found`);
  }

  const challenge = db
    .prepare('SELECT * FROM voice_challenges WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(actionRequestId);

  const verification = db
    .prepare('SELECT * FROM voice_verifications WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(actionRequestId);

  const operations = db
    .prepare('SELECT operation_id, operation_type, status, error_code, updated_at FROM model_operations WHERE action_request_id = ?')
    .all(actionRequestId);

  return {
    actionRequestId: action.id,
    state: action.current_state,
    version: action.current_version,
    challenge: challenge
      ? {
          id: challenge.id,
          nonce: challenge.nonce,
          phrase: challenge.phrase,
          actionHash: challenge.action_hash,
          sttStatus: challenge.stt_status,
          sttTranscript: challenge.stt_transcript,
          consumedAt: challenge.consumed_at,
          expiresAt: challenge.expires_at,
        }
      : null,
    eidos: verification
      ? {
          operationId: verification.eidos_operation_id,
          decision: verification.eidos_decision,
          similarity: verification.eidos_similarity,
        }
      : null,
    aletheia: verification
      ? {
          operationId: verification.aletheia_operation_id,
          verdict: verification.aletheia_verdict,
          score: verification.aletheia_score,
        }
      : null,
    evidenceStatus: verification?.evidence_status || null,
    operations,
  };
}
