import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';

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

async function loginAs(baseUrl, email) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD_DEFAULT }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('Phase 8: dashboard summary reflects persisted actions, financial simulation drift, and policy CRUD', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  const server = createApp({ db, config });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated /api/dashboard/summary rejected
    const unauthSum = await fetch(`${baseUrl}/api/dashboard/summary`);
    assert.equal(unauthSum.status, 401);

    const danCookie = await loginAs(baseUrl, 'dan.sullivan@acme.corp');
    const elenaCookie = await loginAs(baseUrl, 'elena.rostova@acme.corp');
    const marcusCookie = await loginAs(baseUrl, 'marcus.vance@acme.corp');

    // 2. Seeded envelopes include simulated financial envelope & GitHub deployment
    const listRes = await fetch(`${baseUrl}/api/actions`, { headers: { Cookie: elenaCookie } });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    const seededFin = listBody.actions.find((a) => a.id === 'env_fin_sim_9824');
    assert.ok(seededFin);
    assert.match(seededFin.envelope.parameters.purpose, /SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED\./);

    // 3. Initial dashboard summary reflects real DB counts (not hardcoded)
    const sum1 = await (await fetch(`${baseUrl}/api/dashboard/summary`, { headers: { Cookie: elenaCookie } })).json();
    assert.equal(sum1.envelopes.total, 2);
    assert.equal(sum1.policies.activeCount, 4);
    assert.equal(sum1.interceptions.hashDriftBlocked, 0);
    assert.equal(sum1.tokens.mintedCount, 0);

    // 4. Mutate seeded financial action -> version increments, ingressHash preserved, hashDriftBlocked increases
    const mutateRes = await fetch(`${baseUrl}/api/actions/env_fin_sim_9824/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: danCookie },
      body: JSON.stringify({
        parameters: { beneficiaryReference: 'CY-99-OFFSHORE-MOCK' },
        reason: 'Simulated beneficiary hijack',
      }),
    });
    assert.equal(mutateRes.status, 200);
    const mutBody = await mutateRes.json();
    assert.equal(mutBody.mutated, true);
    assert.equal(mutBody.action.version, 2);
    assert.equal(mutBody.action.hasVersionDrift, true);
    assert.notEqual(mutBody.action.ingressHash, mutBody.action.actionHash);

    const sum2 = await (await fetch(`${baseUrl}/api/dashboard/summary`, { headers: { Cookie: elenaCookie } })).json();
    assert.equal(sum2.interceptions.hashDriftBlocked, 1);

    // 5. Create new policy rule as admin -> policy count reflects immediately in dashboard summary
    const polRes = await fetch(`${baseUrl}/api/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({
        id: 'FIN-SIM-08',
        name: 'Treasury Simulation Multi-Sig',
        category: 'FINANCE_APPROVAL',
        target: 'ERP Treasury Sandbox',
        riskTier: 'CRITICAL',
      }),
    });
    assert.equal(polRes.status, 201);

    const sum3 = await (await fetch(`${baseUrl}/api/dashboard/summary`, { headers: { Cookie: marcusCookie } })).json();
    assert.equal(sum3.policies.activeCount, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
