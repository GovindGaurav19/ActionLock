import crypto from 'node:crypto';
import { verifyPassword } from '../db/seed.mjs';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../utils/errors.mjs';

export function hashSessionToken(rawToken, sessionSecret) {
  return crypto.createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    cookies[k] = decodeURIComponent(v);
  }
  return cookies;
}

export function buildSessionCookieHeader(rawToken, config, maxAgeSec) {
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(rawToken)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
  ];
  if (config.isProd) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function getUserRolesAndPermissions(db, userId, orgId) {
  const roles = db
    .prepare(
      `SELECT r.id, r.name
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
       WHERE ra.user_id = ? AND ra.organisation_id = ?`,
    )
    .all(userId, orgId)
    .map((r) => r.name);

  const permissions = db
    .prepare(
      `SELECT DISTINCT rp.permission
       FROM role_assignments ra
       JOIN role_permissions rp ON rp.role_id = ra.role_id
       WHERE ra.user_id = ? AND ra.organisation_id = ?`,
    )
    .all(userId, orgId)
    .map((r) => r.permission);

  return { roles, permissions };
}

export function sanitizeUser(row, roles, permissions) {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    email: row.email,
    displayName: row.display_name,
    title: row.title,
    department: row.department,
    isDemo: Boolean(row.is_demo),
    roles,
    permissions,
  };
}

export function loginWithPassword({ db, config, email, password, ipAddress = null, userAgent = null }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new ValidationError('Email and password are required');
  }

  const user = db
    .prepare(
      `SELECT id, organisation_id, email, display_name, title, department, password_hash, is_demo, is_active
       FROM users WHERE lower(email) = ?`,
    )
    .get(normalizedEmail);

  if (!user || !user.is_active || !verifyPassword(String(password), user.password_hash)) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(rawToken, config.sessionSecret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000).toISOString();
  const sessionId = `ses_${crypto.randomBytes(8).toString('hex')}`;

  db.prepare(
    `INSERT INTO sessions (id, user_id, organisation_id, token_hash, ip_address, user_agent, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, user.id, user.organisation_id, tokenHash, ipAddress, userAgent, expiresAt, now.toISOString());

  const { roles, permissions } = getUserRolesAndPermissions(db, user.id, user.organisation_id);
  const org = db
    .prepare('SELECT id, slug, name, region FROM organisations WHERE id = ?')
    .get(user.organisation_id);

  return {
    rawToken,
    sessionId,
    expiresAt,
    user: sanitizeUser(user, roles, permissions),
    organisation: org,
  };
}

export function logoutSession({ db, config, rawToken }) {
  if (!rawToken) return;
  const tokenHash = hashSessionToken(rawToken, config.sessionSecret);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function getAuthenticatedContext({ db, config, req }) {
  const cookies = parseCookies(req);
  const rawToken = cookies[config.sessionCookieName];
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken, config.sessionSecret);
  const session = db
    .prepare('SELECT id, user_id, organisation_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash);

  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return null;
  }

  const user = db
    .prepare(
      `SELECT id, organisation_id, email, display_name, title, department, is_demo, is_active
       FROM users WHERE id = ?`,
    )
    .get(session.user_id);

  if (!user || !user.is_active) return null;

  const { roles, permissions } = getUserRolesAndPermissions(db, user.id, session.organisation_id);
  const org = db
    .prepare('SELECT id, slug, name, region FROM organisations WHERE id = ?')
    .get(session.organisation_id);

  return {
    sessionId: session.id,
    rawToken,
    user: sanitizeUser(user, roles, permissions),
    organisation: org,
  };
}

export function requireAuth(authCtx) {
  if (!authCtx) {
    throw new UnauthorizedError('Valid authenticated session required');
  }
  return authCtx;
}

export function requirePermission(authCtx, permission) {
  const ctx = requireAuth(authCtx);
  if (!ctx.user.permissions.includes(permission)) {
    throw new ForbiddenError(`Missing required permission: ${permission}`);
  }
  return ctx;
}

export function listDemoAccounts(db) {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.title, u.department, u.is_demo,
              GROUP_CONCAT(r.name, ',') AS role_names
       FROM users u
       LEFT JOIN role_assignments ra ON ra.user_id = u.id
       LEFT JOIN roles r ON r.id = ra.role_id
       WHERE u.is_demo = 1 AND u.is_active = 1
       GROUP BY u.id
       ORDER BY u.display_name ASC`,
    )
    .all();

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    title: r.title,
    department: r.department,
    isDemo: true,
    roles: r.role_names ? String(r.role_names).split(',') : [],
  }));
}
