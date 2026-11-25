import crypto from 'node:crypto';
import { verifyDetectifAiWebhookSignature } from '../crypto.mjs';
import { logger } from '../utils/logger.mjs';
import { recordAuditEvent } from './auditService.mjs';
import { ACTION_STATES, transitionActionState } from './stateMachine.mjs';

const SUPPORTED_DETECTIFAI_EVENTS = new Set([
  'speaker.enrolled',
  'speaker.verified',
  'deepfake.completed',
  'webhook.test',
]);

function extractEventFields(payload) {
  const eventType = payload?.type || payload?.event_type || payload?.event || 'unknown';
  const data = payload?.data || payload?.result || payload || {};
  const operationId = payload?.operation_id || data?.operation_id || null;
  const parentOperationId = payload?.parent_operation_id || data?.parent_operation_id || null;
  return { eventType, data, operationId, parentOperationId };
}

function findOrCreateVerificationRow(db, actionRequestId, challengeId) {
  let row = db
    .prepare('SELECT * FROM voice_verifications WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(actionRequestId);
  if (!row) {
    const now = new Date().toISOString();
    const id = `vrf_${crypto.randomBytes(6).toString('hex')}`;
    db.prepare(
      `INSERT INTO voice_verifications
        (id, action_request_id, challenge_id, evidence_status, created_at, updated_at)
       VALUES (?, ?, ?, 'PENDING', ?, ?)`,
    ).run(id, actionRequestId, challengeId, now, now);
    row = db.prepare('SELECT * FROM voice_verifications WHERE id = ?').get(id);
  }
  return row;
}

function reconcileActionVerification({ db, actionRequestId, eventTime }) {
  const action = db.prepare('SELECT * FROM action_requests WHERE id = ?').get(actionRequestId);
  if (!action) return;

  // Monotonic protection: never regress or mutate terminal or post-voice states except fake hold before approval
  const postVoiceStates = new Set([
    ACTION_STATES.WAITING_FOR_PASSKEY,
    ACTION_STATES.WAITING_FOR_PEER_APPROVAL,
    ACTION_STATES.APPROVED,
    ACTION_STATES.TOKEN_ISSUED,
    ACTION_STATES.CONSUMED,
    ACTION_STATES.REJECTED,
    ACTION_STATES.EXPIRED,
  ]);
  if (postVoiceStates.has(action.current_state)) {
    return;
  }

  const verification = db
    .prepare('SELECT * FROM voice_verifications WHERE action_request_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(actionRequestId);
  if (!verification) return;

  const challenge = db.prepare('SELECT * FROM voice_challenges WHERE id = ?').get(verification.challenge_id);
  const now = new Date().toISOString();

  if (verification.aletheia_verdict === 'fake') {
    db.prepare("UPDATE voice_verifications SET evidence_status = 'ALETHEIA_FAKE', updated_at = ? WHERE id = ?").run(
      now,
      verification.id,
    );
    if (action.current_state !== ACTION_STATES.HOLD) {
      transitionActionState({
        db,
        actionRequestId,
        toState: ACTION_STATES.HOLD,
        reason: 'Webhook reconciliation: Aletheia reported verdict=fake',
        metadata: { eventTime, aletheiaOperationId: verification.aletheia_operation_id },
        skipIntegrityCheck: true,
      });
    }
    const existingInc = db
      .prepare("SELECT id FROM security_incidents WHERE action_request_id = ? AND status = 'OPEN'")
      .get(actionRequestId);
    if (!existingInc) {
      db.prepare(
        `INSERT INTO security_incidents
          (id, organisation_id, action_request_id, severity, title, reason, status, created_at, updated_at)
         VALUES (?, ?, ?, 'SEV-1 CRITICAL', ?, ?, 'OPEN', ?, ?)`,
      ).run(
        `inc_${crypto.randomBytes(5).toString('hex')}`,
        action.organisation_id,
        actionRequestId,
        'Synthetic speech flagged via DetectifAI webhook',
        `Aletheia verdict=fake (score=${verification.aletheia_score})`,
        now,
        now,
      );
    }
    return;
  }

  if (verification.eidos_decision === 'no_match') {
    db.prepare("UPDATE voice_verifications SET evidence_status = 'EIDOS_NO_MATCH', updated_at = ? WHERE id = ?").run(
      now,
      verification.id,
    );
    if (action.current_state !== ACTION_STATES.HOLD) {
      transitionActionState({
        db,
        actionRequestId,
        toState: ACTION_STATES.HOLD,
        reason: 'Webhook reconciliation: Eidos reported decision=no_match',
        metadata: { eventTime, eidosOperationId: verification.eidos_operation_id },
        skipIntegrityCheck: true,
      });
    }
    return;
  }

  if (
    verification.eidos_decision === 'match' &&
    verification.aletheia_verdict === 'real' &&
    challenge?.stt_status === 'MATCHED'
  ) {
    db.prepare("UPDATE voice_verifications SET evidence_status = 'DUAL_VERIFIED', updated_at = ? WHERE id = ?").run(
      now,
      verification.id,
    );
    if (action.current_state === ACTION_STATES.VOICE_CHECK_PENDING || action.current_state === ACTION_STATES.HOLD) {
      transitionActionState({
        db,
        actionRequestId,
        toState: ACTION_STATES.VOICE_VERIFIED,
        reason: 'Webhook reconciliation: STT + Eidos match + Aletheia real complete',
        metadata: { eventTime },
      });
    }
  }
}

export function processSingleWebhookEvent(db, webhookRow) {
  const payload = JSON.parse(webhookRow.payload_json);
  const { eventType, data, operationId, parentOperationId } = extractEventFields(payload);
  const now = new Date().toISOString();

  if (!SUPPORTED_DETECTIFAI_EVENTS.has(eventType)) {
    db.prepare("UPDATE webhook_events SET processing_status = 'IGNORED', processed_at = ? WHERE id = ?").run(
      now,
      webhookRow.id,
    );
    return;
  }

  if (eventType === 'webhook.test') {
    db.prepare("UPDATE webhook_events SET processing_status = 'PROCESSED', processed_at = ? WHERE id = ?").run(
      now,
      webhookRow.id,
    );
    return;
  }

  if (eventType === 'speaker.enrolled') {
    const speakerId = data?.speaker_id || payload?.speaker_id;
    if (speakerId) {
      db.prepare(
        `UPDATE speaker_profiles SET status = 'ENROLLED', last_operation_id = COALESCE(?, last_operation_id), updated_at = ?
         WHERE detectifai_speaker_id = ? AND deleted_at IS NULL`,
      ).run(operationId, now, speakerId);
    }
    if (operationId) {
      db.prepare("UPDATE model_operations SET status = 'SUCCEEDED', updated_at = ? WHERE operation_id = ?").run(
        now,
        operationId,
      );
    }
    db.prepare("UPDATE webhook_events SET processing_status = 'PROCESSED', processed_at = ? WHERE id = ?").run(
      now,
      webhookRow.id,
    );
    return;
  }

  // Correlate speaker.verified and deepfake.completed strictly via stored operation_id (or parent_operation_id)
  const opRow =
    (operationId && db.prepare('SELECT * FROM model_operations WHERE operation_id = ?').get(operationId)) ||
    (parentOperationId && db.prepare('SELECT * FROM model_operations WHERE operation_id = ?').get(parentOperationId)) ||
    null;

  if (!opRow || !opRow.action_request_id) {
    db.prepare("UPDATE webhook_events SET processing_status = 'UNCORRELATED', processed_at = ? WHERE id = ?").run(
      now,
      webhookRow.id,
    );
    return;
  }

  db.prepare(
    "UPDATE model_operations SET status = 'SUCCEEDED', raw_response_json = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(payload), now, opRow.id);

  const verification = findOrCreateVerificationRow(db, opRow.action_request_id, opRow.challenge_id);

  if (eventType === 'speaker.verified') {
    const resObj = data?.result || data;
    const decision = resObj?.decision === 'match' || resObj?.decision === 'no_match' ? resObj.decision : null;
    const similarity = typeof resObj?.similarity === 'number' ? resObj.similarity : null;
    db.prepare(
      `UPDATE voice_verifications
       SET eidos_operation_id = COALESCE(eidos_operation_id, ?),
           eidos_decision = COALESCE(?, eidos_decision),
           eidos_similarity = COALESCE(?, eidos_similarity),
           updated_at = ?
       WHERE id = ?`,
    ).run(operationId, decision, similarity, now, verification.id);
  } else if (eventType === 'deepfake.completed') {
    const resObj = data?.result || data;
    const verdict = resObj?.verdict === 'real' || resObj?.verdict === 'fake' ? resObj.verdict : null;
    const score = typeof resObj?.score === 'number' ? resObj.score : null;
    db.prepare(
      `UPDATE voice_verifications
       SET aletheia_operation_id = COALESCE(aletheia_operation_id, ?),
           aletheia_verdict = COALESCE(?, aletheia_verdict),
           aletheia_score = COALESCE(?, aletheia_score),
           updated_at = ?
       WHERE id = ?`,
    ).run(operationId, verdict, score, now, verification.id);
  }

  reconcileActionVerification({
    db,
    actionRequestId: opRow.action_request_id,
    eventTime: payload?.created_at || payload?.timestamp || now,
  });

  const actionRow = db.prepare('SELECT organisation_id FROM action_requests WHERE id = ?').get(opRow.action_request_id);
  if (actionRow) {
    recordAuditEvent({
      db,
      organisationId: actionRow.organisation_id,
      actionRequestId: opRow.action_request_id,
      eventType: 'WEBHOOK_RECONCILED',
      payload: { webhookId: webhookRow.webhook_id, eventType, operationId },
    });
  }

  db.prepare("UPDATE webhook_events SET processing_status = 'PROCESSED', processed_at = ? WHERE id = ?").run(
    now,
    webhookRow.id,
  );
}

export function processPendingWebhooks(db) {
  const pending = db
    .prepare("SELECT * FROM webhook_events WHERE processing_status = 'PENDING' ORDER BY received_at ASC")
    .all();
  let processed = 0;
  for (const row of pending) {
    try {
      processSingleWebhookEvent(db, row);
      processed += 1;
    } catch (err) {
      logger.error('Webhook background processing error', { webhookId: row.webhook_id, err: err?.message });
      db.prepare("UPDATE webhook_events SET processing_status = 'FAILED', processed_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        row.id,
      );
    }
  }
  return processed;
}

/**
 * Verifies raw-body HMAC signature, deduplicates by webhook-id, persists immediately,
 * and schedules background processing so the HTTP 2xx response returns well within 10s.
 */
export function ingestDetectifAiWebhook({ db, config, headers, rawBody, scheduleAsync = true }) {
  const verification = verifyDetectifAiWebhookSignature({
    secret: config.detectifAi.webhookSecret,
    headers,
    rawBody,
  });

  if (!verification.valid) {
    return { status: 401, body: { accepted: false, reason: verification.reason } };
  }

  const webhookId = String(headers['webhook-id']);
  const existing = db
    .prepare("SELECT id FROM webhook_events WHERE provider = 'detectifai' AND webhook_id = ?")
    .get(webhookId);

  if (existing) {
    return { status: 200, body: { accepted: true, deduplicated: true } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { accepted: false, reason: 'invalid_json' } };
  }

  const { eventType, operationId } = extractEventFields(payload);
  const now = new Date().toISOString();
  const id = `whk_${crypto.randomBytes(6).toString('hex')}`;

  try {
    db.prepare(
      `INSERT INTO webhook_events
        (id, provider, webhook_id, event_type, operation_id, signature_valid, processing_status, payload_json, received_at)
       VALUES (?, 'detectifai', ?, ?, ?, 1, 'PENDING', ?, ?)`,
    ).run(id, webhookId, eventType, operationId, rawBody.toString('utf8'), now);
  } catch {
    // Unique constraint hit under concurrent delivery
    return { status: 200, body: { accepted: true, deduplicated: true } };
  }

  if (scheduleAsync) {
    setImmediate(() => {
      try {
        processPendingWebhooks(db);
      } catch (err) {
        logger.error('Async webhook worker failed', { err: err?.message });
      }
    });
  }

  return { status: 200, body: { accepted: true, deduplicated: false, queuedId: id } };
}

export function listWebhookEvents(db, limit = 100) {
  return db
    .prepare(
      `SELECT id, provider, webhook_id, event_type, operation_id, signature_valid, processing_status, payload_json, received_at, processed_at
       FROM webhook_events
       ORDER BY received_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({
      id: r.id,
      provider: r.provider,
      webhookId: r.webhook_id,
      eventType: r.event_type,
      operationId: r.operation_id,
      signatureValid: Boolean(r.signature_valid),
      processingStatus: r.processing_status,
      payload: JSON.parse(r.payload_json),
      receivedAt: r.received_at,
      processedAt: r.processed_at,
    }));
}
