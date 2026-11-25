import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, hashPassword, seedDatabase, verifyPassword } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { sanitizeForLog } from '../utils/logger.mjs';

function makeTestConfig() {
  return {
    port: 0,
    nodeEnv: 'test',
    isProd: false,
    sqliteDbPath: ':memory:',
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    sessionCookieName: 'actionlock_sid',
    sessionTtlSeconds: 3600,
    actionTokenSecret: crypto.randomBytes(32).toString('hex'),
    detectifAi: { apiKey: '', baseUrl: 'https://platform.detectif.ai', webhookSecret: '' },
    stt: { projectId: '', credentialsPath: '', languageCode: 'en-US' },
    github: { appId: '', privateKey: '', webhookSecret: '' },
    webauthn: { rpId: 'localhost', rpName: 'ACTIONLOCK Enterprise', origin: 'http://localhost:5173' },
  };
}

async function startTestServer() {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);
  seedDatabase(db); // Verify idempotency
  const server = createApp({ db, config });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, db, baseUrl: `http://127.0.0.1:${port}` };
}

test('Phase 1: database migrations, idempotent seeding, and scrypt password verification', () => {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  seedDatabase(db);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const required of [
    'organisations',
    'users',
    'sessions',
    'roles',
    'role_permissions',
    'role_assignments',
    'speaker_profiles',
    'voice_consents',
    'action_requests',
    'action_envelopes',
    'voice_challenges',
    'voice_verifications',
    'webhook_events',
    'approval_policies',
    'approvals',
    'passkey_credentials',
    'authorization_tokens',
    'audit_events',
    'security_incidents',
    'break_glass_events',
  ]) {
    assert.ok(tables.includes(required), `Missing table ${required}`);
  }

  const usersCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  assert.equal(usersCount, 6);

  const hash = hashPassword('MyStrongPass!1');
  assert.equal(verifyPassword('MyStrongPass!1', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);
});

test('Phase 1: logger redacts sensitive keys', () => {
  const sanitized = sanitizeForLog({
    email: 'alex.chen@acme.corp',
    password: 'secret',
    DETECTIF_API_KEY: 'dtf_123',
    headers: { Authorization: 'Bearer xyz', cookie: 'actionlock_sid=abc' },
  });
  assert.equal(sanitized.email, 'alex.chen@acme.corp');
  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.DETECTIF_API_KEY, '[REDACTED]');
  assert.equal(sanitized.headers.Authorization, '[REDACTED]');
  assert.equal(sanitized.headers.cookie, '[REDACTED]');
});

test('Phase 1: login, HTTP-only session cookie, /api/auth/me, RBAC, and logout', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    // 1. Unauthenticated /api/auth/me returns 401
    const unauth = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(unauth.status, 401);

    // 2. Demo accounts list omits password hashes
    const demoRes = await fetch(`${baseUrl}/api/auth/demo-accounts`);
    assert.equal(demoRes.status, 200);
    const demoJson = await demoRes.json();
    assert.equal(demoJson.accounts.length, 6);
    assert.equal(demoJson.accounts[0].password_hash, undefined);

    // 3. Invalid password returns 401
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex.chen@acme.corp', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    // 4. Valid login as REQUESTER (Alex Chen)
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex.chen@acme.corp', password: DEMO_PASSWORD_DEFAULT }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.match(setCookie, /actionlock_sid=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookiePair = setCookie.split(';')[0];

    const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookiePair } });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.email, 'alex.chen@acme.corp');
    assert.ok(meJson.user.roles.includes('REQUESTER'));

    // 5. RBAC denies REQUESTER on org:read and policy:manage
    const deniedOrg = await fetch(`${baseUrl}/api/org`, { headers: { Cookie: cookiePair } });
    assert.equal(deniedOrg.status, 403);

    // 6. Logout invalidates session
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookiePair },
    });
    assert.equal(logoutRes.status, 200);
    const afterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookiePair } });
    assert.equal(afterLogout.status, 401);

    // 7. Login as SECOPS_ADMIN (Marcus Vance) allows /api/org & policy:manage check
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'marcus.vance@acme.corp', password: DEMO_PASSWORD_DEFAULT }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];

    const orgRes = await fetch(`${baseUrl}/api/org`, { headers: { Cookie: adminCookie } });
    assert.equal(orgRes.status, 200);
    const orgJson = await orgRes.json();
    assert.equal(orgJson.organisation.id, 'org_acme_enterprise');
    assert.equal(orgJson.members.length, 6);

    const rbacRes = await fetch(`${baseUrl}/api/rbac/check?permission=policy:manage`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(rbacRes.status, 200);
    const rbacJson = await rbacRes.json();
    assert.equal(rbacJson.allowed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
