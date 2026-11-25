import crypto from 'node:crypto';
import { ForbiddenError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';

export function listBreakGlassEvents(db, organisationId) {
  return db
    .prepare(
      `SELECT bg.*, u.email AS initiator_email, u.display_name AS initiator_name
       FROM break_glass_events bg
       LEFT JOIN users u ON u.id = bg.initiated_by_user_id
       WHERE bg.organisation_id = ?
       ORDER BY bg.created_at DESC`,
    )
    .all(organisationId)
    .map((r) => ({
      id: r.id,
      organisationId: r.organisation_id,
      initiatedByUserId: r.initiated_by_user_id,
      initiatedByEmail: r.initiator_email,
      initiatedByName: r.initiator_name,
      custodians: JSON.parse(r.custodian_ids_json),
      ticketId: r.ticket_id,
      justification: r.justification,
      targetScope: r.target_scope,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
}

/**
 * Logs an audited manual Break-Glass emergency access invocation.
 * Does NOT fabricate hardware HSM, SmartCard, WORM optical drive, or satellite channels.
 */
export function createBreakGlassEvent({ db, authCtx, input }) {
  const ticketId = String(input.ticketId || '').trim();
  const justification = String(input.justification || '').trim();
  const targetScope = String(input.targetScope || '').trim();
  const custodians = Array.isArray(input.custodians)
    ? input.custodians.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  const uniqueCustodians = [...new Set(custodians)];

  if (!ticketId) {
    throw new ValidationError('Incident or change ticketId is required');
  }
  if (justification.length < 15) {
    throw new ValidationError('Detailed incident justification (>= 15 characters) is required');
  }
  if (!targetScope) {
    throw new ValidationError('Bounded emergency targetScope is required');
  }
  if (uniqueCustodians.length < 2) {
    throw new ForbiddenError('At least 2 distinct custodians are required for Break-Glass accountability');
  }
  if (input.acknowledgedRunbook !== true) {
    throw new ValidationError('Manual Break-Glass runbook acknowledgment is required');
  }

  const ttlMinutes = Math.min(Math.max(Number(input.ttlMinutes || 60), 15), 120);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  const id = `bg_${crypto.randomBytes(6).toString('hex')}`;

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `INSERT INTO break_glass_events
        (id, organisation_id, initiated_by_user_id, custodian_ids_json, ticket_id, justification, target_scope, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      authCtx.organisation.id,
      authCtx.user.id,
      JSON.stringify(uniqueCustodians),
      ticketId,
      justification,
      targetScope,
      expiresAt,
      createdAt,
    );

    recordAuditEvent({
      db,
      organisationId: authCtx.organisation.id,
      actorUserId: authCtx.user.id,
      eventType: 'BREAK_GLASS_INITIATED',
      payload: {
        breakGlassId: id,
        ticketId,
        custodians: uniqueCustodians,
        targetScope,
        ttlMinutes,
        expiresAt,
        mode: 'MANUAL_OUT_OF_BAND_RUNBOOK',
      },
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return listBreakGlassEvents(db, authCtx.organisation.id).find((e) => e.id === id);
}
