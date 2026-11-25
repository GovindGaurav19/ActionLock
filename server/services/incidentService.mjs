import crypto from 'node:crypto';
import { NotFoundError, ValidationError } from '../utils/errors.mjs';
import { recordAuditEvent } from './auditService.mjs';

const VALID_INCIDENT_STATUSES = new Set(['OPEN', 'INVESTIGATING', 'BLOCKED', 'RESOLVED']);

export function createSecurityIncident({
  db,
  organisationId,
  actionRequestId = null,
  severity = 'SEV-1 CRITICAL',
  title,
  reason,
}) {
  if (!title || !reason) {
    throw new ValidationError('Incident title and reason are required');
  }
  const now = new Date().toISOString();
  const id = `inc_${crypto.randomBytes(5).toString('hex')}`;
  db.prepare(
    `INSERT INTO security_incidents
      (id, organisation_id, action_request_id, severity, title, reason, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
  ).run(id, organisationId, actionRequestId, severity, title, reason, now, now);

  recordAuditEvent({
    db,
    organisationId,
    actionRequestId,
    eventType: 'INCIDENT_OPENED',
    payload: { incidentId: id, severity, title, reason },
  });

  return listIncidents(db, organisationId).find((inc) => inc.id === id);
}

export function listIncidents(db, organisationId) {
  const rows = db
    .prepare(
      `SELECT si.*, ar.target_system, ar.category, ar.current_state,
              app.email AS claimed_approver_email,
              (SELECT vv.aletheia_score FROM voice_verifications vv WHERE vv.action_request_id = si.action_request_id ORDER BY vv.created_at DESC LIMIT 1) AS aletheia_score,
              (SELECT vv.aletheia_verdict FROM voice_verifications vv WHERE vv.action_request_id = si.action_request_id ORDER BY vv.created_at DESC LIMIT 1) AS aletheia_verdict,
              (SELECT vv.eidos_decision FROM voice_verifications vv WHERE vv.action_request_id = si.action_request_id ORDER BY vv.created_at DESC LIMIT 1) AS eidos_decision,
              (SELECT vv.eidos_similarity FROM voice_verifications vv WHERE vv.action_request_id = si.action_request_id ORDER BY vv.created_at DESC LIMIT 1) AS eidos_similarity
       FROM security_incidents si
       LEFT JOIN action_requests ar ON ar.id = si.action_request_id
       LEFT JOIN users app ON app.id = ar.claimed_approver_user_id
       WHERE si.organisation_id = ?
       ORDER BY si.created_at DESC`,
    )
    .all(organisationId);

  return rows.map((r) => ({
    id: r.id,
    organisationId: r.organisation_id,
    actionRequestId: r.action_request_id,
    severity: r.severity,
    title: r.title,
    reason: r.reason,
    status: r.status,
    target: r.target_system || r.category || 'Gateway Enclave',
    actionState: r.current_state || null,
    claimedApprover: r.claimed_approver_email || 'N/A',
    aletheiaScore: typeof r.aletheia_score === 'number' ? r.aletheia_score : null,
    aletheiaVerdict: r.aletheia_verdict ? String(r.aletheia_verdict).toUpperCase() : null,
    eidosDecision: r.eidos_decision ? String(r.eidos_decision).toUpperCase() : null,
    eidosSimilarity: typeof r.eidos_similarity === 'number' ? r.eidos_similarity : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function updateIncidentStatus({ db, authCtx, incidentId, status, note = '' }) {
  const normalized = String(status || '').trim().toUpperCase();
  if (!VALID_INCIDENT_STATUSES.has(normalized)) {
    throw new ValidationError(`Invalid incident status: ${status}. Allowed: OPEN, INVESTIGATING, BLOCKED, RESOLVED`);
  }

  const existing = db
    .prepare('SELECT * FROM security_incidents WHERE id = ? AND organisation_id = ?')
    .get(incidentId, authCtx.organisation.id);
  if (!existing) {
    throw new NotFoundError(`Security incident ${incidentId} not found`);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE security_incidents SET status = ?, updated_at = ? WHERE id = ?').run(normalized, now, incidentId);

  recordAuditEvent({
    db,
    organisationId: authCtx.organisation.id,
    actionRequestId: existing.action_request_id,
    actorUserId: authCtx.user.id,
    eventType: 'INCIDENT_STATUS_UPDATED',
    payload: {
      incidentId,
      previousStatus: existing.status,
      newStatus: normalized,
      note: note || `Transitioned to ${normalized}`,
    },
  });

  return listIncidents(db, authCtx.organisation.id).find((inc) => inc.id === incidentId);
}
