import crypto from 'node:crypto';
import { canonicalizeJson } from '../crypto.mjs';

export function recordAuditEvent({
  db,
  organisationId,
  actionRequestId = null,
  actorUserId = null,
  eventType,
  payload = {},
}) {
  const prevRow = db
    .prepare(
      `SELECT event_hash FROM audit_events WHERE organisation_id = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .get(organisationId);

  const previousHash = prevRow ? prevRow.event_hash : 'sha256:00000000000000000000000000000000';
  const createdAt = new Date().toISOString();
  const id = `evt_${crypto.randomBytes(8).toString('hex')}`;
  const canonicalPayload = canonicalizeJson(payload);
  const eventHash =
    'sha256:' +
    crypto
      .createHash('sha256')
      .update(`${previousHash}|${organisationId}|${actionRequestId || ''}|${eventType}|${createdAt}|${canonicalPayload}`)
      .digest('hex');

  db.prepare(
    `INSERT INTO audit_events
      (id, organisation_id, action_request_id, actor_user_id, event_type, previous_hash, event_hash, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, organisationId, actionRequestId, actorUserId, eventType, previousHash, eventHash, canonicalPayload, createdAt);

  return { id, eventType, previousHash, eventHash, createdAt };
}

export function listAuditEvents(db, organisationId, limit = 100) {
  return db
    .prepare(
      `SELECT id, organisation_id, action_request_id, actor_user_id, event_type, previous_hash, event_hash, payload_json, created_at
       FROM audit_events
       WHERE organisation_id = ?
       ORDER BY rowid DESC
       LIMIT ?`,
    )
    .all(organisationId, limit)
    .map((r) => ({
      id: r.id,
      organisationId: r.organisation_id,
      actionRequestId: r.action_request_id,
      actorUserId: r.actor_user_id,
      eventType: r.event_type,
      previousHash: r.previous_hash,
      eventHash: r.event_hash,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
    }));
}

/**
 * Verifies the entire append-only SHA-256 hash chain for an organisation in chronological order.
 */
export function verifyAuditChain(db, organisationId) {
  const rows = db
    .prepare(
      `SELECT id, organisation_id, action_request_id, actor_user_id, event_type, previous_hash, event_hash, payload_json, created_at
       FROM audit_events
       WHERE organisation_id = ?
       ORDER BY rowid ASC`,
    )
    .all(organisationId);

  const GENESIS_PREV = 'sha256:00000000000000000000000000000000';
  let expectedPrev = GENESIS_PREV;
  let verifiedCount = 0;

  for (const row of rows) {
    if (row.previous_hash !== expectedPrev) {
      return {
        valid: false,
        totalCount: rows.length,
        verifiedCount,
        brokenAtId: row.id,
        reason: 'previous_hash_mismatch',
        headHash: rows[rows.length - 1]?.event_hash || null,
      };
    }

    const expectedHash =
      'sha256:' +
      crypto
        .createHash('sha256')
        .update(
          `${row.previous_hash}|${row.organisation_id}|${row.action_request_id || ''}|${row.event_type}|${row.created_at}|${row.payload_json}`,
        )
        .digest('hex');

    if (row.event_hash !== expectedHash) {
      return {
        valid: false,
        totalCount: rows.length,
        verifiedCount,
        brokenAtId: row.id,
        reason: 'event_hash_mismatch',
        headHash: rows[rows.length - 1]?.event_hash || null,
      };
    }

    expectedPrev = row.event_hash;
    verifiedCount += 1;
  }

  return {
    valid: true,
    totalCount: rows.length,
    verifiedCount,
    brokenAtId: null,
    reason: rows.length === 0 ? 'empty_chain' : 'verified',
    genesisHash: rows[0]?.previous_hash || GENESIS_PREV,
    headHash: rows[rows.length - 1]?.event_hash || null,
  };
}
