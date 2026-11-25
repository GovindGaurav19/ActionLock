import crypto from 'node:crypto';
import {
  buildDetectifAiSpeakerId,
  deleteDetectifAiSpeaker,
  enrollSpeakerWithDetectifAi,
} from '../detectifai.mjs';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
]);

export const CONSENT_VERSION = 'v1.0-detectifai-30d';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_SAMPLES_PER_SPEAKER = 5;

export function validateEnrollmentAudio({ audioBase64, mimeType, durationSeconds }) {
  const cleanMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIME_TYPES.has(cleanMime)) {
    throw new ValidationError(`Unsupported audio MIME type: ${mimeType || 'unknown'}`);
  }
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new ValidationError('Audio recording payload (audioBase64) is required');
  }
  const buffer = Buffer.from(audioBase64, 'base64');
  if (buffer.length < 1024) {
    throw new ValidationError('Audio recording is too short or empty (< 1 KB)');
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new ValidationError('Audio recording exceeds 25 MB limit');
  }
  if (durationSeconds !== undefined && durationSeconds !== null) {
    const d = Number(durationSeconds);
    if (!Number.isFinite(d) || d < 15 || d > 60) {
      throw new ValidationError('Enrollment audio duration must be between 15 and 60 seconds (with >= 10s clear speech)');
    }
  }
  return { buffer, mimeType: cleanMime };
}

export function listSpeakerProfiles(db, organisationId) {
  return db
    .prepare(
      `SELECT sp.*, u.email, u.display_name, u.title, u.department,
              vc.consent_version, vc.retention_acknowledged, vc.consented_at, vc.revoked_at
       FROM speaker_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN voice_consents vc ON vc.speaker_profile_id = sp.id
       WHERE sp.organisation_id = ?
       ORDER BY sp.updated_at DESC`,
    )
    .all(organisationId)
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      title: r.title,
      department: r.department,
      speakerId: r.detectifai_speaker_id,
      enrollmentCount: r.enrollment_count,
      status: r.status,
      lastOperationId: r.last_operation_id,
      consentVersion: r.consent_version,
      retentionAcknowledged: Boolean(r.retention_acknowledged),
      consentedAt: r.consented_at,
      revokedAt: r.revoked_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    }));
}

export async function enrollSpeakerProfile(
  { db, authCtx, input },
  { enrollProvider = enrollSpeakerWithDetectifAi } = {},
) {
  const targetUserId = input.userId || authCtx.user.id;
  const userRow = db
    .prepare('SELECT id, email, display_name, title, department, is_active FROM users WHERE id = ? AND organisation_id = ?')
    .get(targetUserId, authCtx.organisation.id);

  if (!userRow || !userRow.is_active) {
    throw new NotFoundError('Target user not found in organisation');
  }

  // Explicit informed consent check BEFORE calling DetectifAI
  if (input.consentAccepted !== true || input.retentionAcknowledged !== true) {
    throw new ValidationError(
      'Explicit informed consent and acknowledgment of DetectifAI 30-day audio retention are required prior to voice enrollment',
    );
  }

  const { buffer, mimeType } = validateEnrollmentAudio({
    audioBase64: input.audioBase64,
    mimeType: input.mimeType,
    durationSeconds: input.durationSeconds,
  });

  const speakerId = buildDetectifAiSpeakerId(`spk_${userRow.id}`);
  const existing = db
    .prepare('SELECT * FROM speaker_profiles WHERE detectifai_speaker_id = ? AND deleted_at IS NULL')
    .get(speakerId);

  if (existing && existing.enrollment_count >= MAX_SAMPLES_PER_SPEAKER) {
    throw new ConflictError(`Maximum ${MAX_SAMPLES_PER_SPEAKER} enrollment samples already recorded for speaker ${speakerId}`);
  }

  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
  const providerRes = await enrollProvider({
    audioBuffer: buffer,
    mimeType,
    fileName: input.fileName || 'enrollment.webm',
    speakerId,
    displayName: userRow.display_name,
    idempotencyKey,
  });

  // Temporary application-side audio buffer reference released after upload; never persisted to DB.
  if (!providerRes.ok) {
    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actorUserId: authCtx.user.id,
      eventType: 'SPEAKER_ENROLLMENT_FAILED',
      payload: { targetUserId: userRow.id, speakerId, code: providerRes.code },
    });
    throw new AppError(503, providerRes.code || 'DETECTIFAI_UNAVAILABLE', providerRes.message);
  }

  const operationId = providerRes.data?.operation_id || providerRes.data?.request_id || null;
  const nowIso = new Date().toISOString();
  const profileId = existing?.id || `spf_${crypto.randomBytes(6).toString('hex')}`;
  const consentId = `vcs_${crypto.randomBytes(6).toString('hex')}`;
  const newCount = (existing?.enrollment_count || 0) + 1;

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (existing) {
      db.prepare(
        `UPDATE speaker_profiles
         SET enrollment_count = ?, status = 'ENROLLED', last_operation_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(newCount, operationId, nowIso, profileId);
    } else {
      db.prepare(
        `INSERT INTO speaker_profiles
          (id, user_id, organisation_id, detectifai_speaker_id, enrollment_count, status, last_operation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'ENROLLED', ?, ?, ?)`,
      ).run(profileId, userRow.id, authCtx.organisation.id, speakerId, operationId, nowIso, nowIso);
    }

    db.prepare(
      `INSERT INTO voice_consents
        (id, user_id, speaker_profile_id, consent_version, retention_acknowledged, consented_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(consentId, userRow.id, profileId, input.consentVersion || CONSENT_VERSION, nowIso);

    if (operationId) {
      db.prepare(
        `INSERT OR REPLACE INTO model_operations
          (id, provider, operation_id, operation_type, status, raw_response_json, created_at, updated_at)
         VALUES (?, 'detectifai', ?, 'speaker.enroll', 'COMPLETED', ?, ?, ?)`,
      ).run(`mop_${crypto.randomBytes(6).toString('hex')}`, operationId, JSON.stringify(providerRes.data), nowIso, nowIso);
    }

    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actorUserId: authCtx.user.id,
      eventType: 'SPEAKER_ENROLLED',
      payload: {
        speakerId,
        targetUserId: userRow.id,
        enrollmentCount: newCount,
        operationId,
        consentVersion: input.consentVersion || CONSENT_VERSION,
      },
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return listSpeakerProfiles(db, authCtx.organisation.id).find((p) => p.id === profileId);
}

export async function deleteSpeakerProfile(
  { db, authCtx, speakerId },
  { deleteProvider = deleteDetectifAiSpeaker } = {},
) {
  const existing = db
    .prepare('SELECT * FROM speaker_profiles WHERE detectifai_speaker_id = ? AND organisation_id = ?')
    .get(speakerId, authCtx.organisation.id);
  if (!existing) {
    throw new NotFoundError(`Speaker profile ${speakerId} not found`);
  }

  const providerRes = await deleteProvider(speakerId);
  if (!providerRes.ok) {
    throw new AppError(503, providerRes.code || 'DETECTIFAI_UNAVAILABLE', providerRes.message);
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `UPDATE speaker_profiles SET status = 'DELETED', deleted_at = ?, updated_at = ? WHERE id = ?`,
    ).run(nowIso, nowIso, existing.id);

    db.prepare(
      `UPDATE voice_consents SET revoked_at = ? WHERE speaker_profile_id = ? AND revoked_at IS NULL`,
    ).run(nowIso, existing.id);

    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actorUserId: authCtx.user.id,
      eventType: 'SPEAKER_DELETED',
      payload: { speakerId, profileId: existing.id },
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return { deleted: true, speakerId, deletedAt: nowIso };
}
