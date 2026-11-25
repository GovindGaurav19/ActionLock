import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { parseDetectifAiVerifyResponse } from '../detectifai.mjs';
import { verifyAuditChain } from '../services/auditService.mjs';

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

test('Phase 9: hash-chained audit verification, real security incident triage, and audited Break-Glass log', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  let lastPhrase = '';
  const server = createApp({
    db,
    config,
    speakerProvider: {
      enroll: async ({ speakerId }) => ({ ok: true, data: { operation_id: 'op_enr_p9', speaker_id: speakerId } }),
    },
    sttProvider: async () => ({ ok: true, transcript: lastPhrase }),
    verifyProvider: async () => {
      const raw = {
        operation_id: 'op_eidos_p9',
        result: { decision: 'match', similarity: 0.91, duration_seconds: 12.0 },
        deepfake: { operation_id: 'op_aletheia_p9', verdict: 'fake', score: 0.93 },
      };
      return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sampleAudio = Buffer.alloc(4096, 4).toString('base64');

  try {
    const alexCookie = await loginAs(baseUrl, 'alex.chen@acme.corp');
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');
    const marcusCookie = await loginAs(baseUrl, 'marcus.vance@acme.corp');

    // 1. Trigger post-challenge payload mutation incident
    const createRes = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        category: 'FINANCE_APPROVAL',
        claimedApproverEmail: 'sarah.jenkins@acme.corp',
        environment: 'simulation',
        parameters: {
          vendorReference: 'CloudScale Corp US',
          beneficiaryReference: 'SIM-ORIG-1111',
          amount: 150000,
          currency: 'USD',
          purpose: 'SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED.',
        },
      }),
    });
    assert.equal(createRes.status, 201);
    const { action: finAction } = await createRes.json();

    const ch1 = await fetch(`${baseUrl}/api/actions/${finAction.id}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({}),
    });
    assert.equal(ch1.status, 201);

    const mutRes = await fetch(`${baseUrl}/api/actions/${finAction.id}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        parameters: { beneficiaryReference: 'SIM-TAMPERED-9999' },
        reason: 'Injected destination alteration',
      }),
    });
    assert.equal(mutRes.status, 200);

    // 2. Also trigger spoof incident via Aletheia verdict=fake
    await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/wav',
        durationSeconds: 18,
        consentAccepted: true,
        retentionAcknowledged: true,
      }),
    });
    const act2 = (
      await (
        await fetch(`${baseUrl}/api/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
          body: JSON.stringify({
            category: 'GITHUB_DEPLOYMENT',
            claimedApproverEmail: 'sarah.jenkins@acme.corp',
            parameters: {
              repositoryOwner: 'acme-corp',
              repositoryName: 'core-auth',
              commitSha: 'deadbeef1234',
              workflowRunId: '8812',
              targetEnvironment: 'production',
            },
          }),
        })
      ).json()
    ).action;
    const ch2 = await (
      await fetch(`${baseUrl}/api/actions/${act2.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({}),
      })
    ).json();
    lastPhrase = ch2.challenge.phrase;

    await fetch(`${baseUrl}/api/actions/${act2.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/wav',
        durationSeconds: 11,
        idempotencyKey: 'idem_p9_fake',
      }),
    });

    // 3. List incidents -> both drift & fake incidents recorded; RBAC enforced on PATCH
    const incList = await (await fetch(`${baseUrl}/api/incidents`, { headers: { Cookie: sarahCookie } })).json();
    assert.ok(incList.incidents.length >= 2);
    const driftInc = incList.incidents.find((i) => i.actionRequestId === finAction.id);
    const spoofInc = incList.incidents.find((i) => i.actionRequestId === act2.id);
    assert.ok(driftInc);
    assert.ok(spoofInc);
    assert.equal(spoofInc.aletheiaVerdict, 'FAKE');

    const nonAdminPatch = await fetch(`${baseUrl}/api/incidents/${spoofInc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ status: 'INVESTIGATING' }),
    });
    assert.equal(nonAdminPatch.status, 403);

    const adminPatch = await fetch(`${baseUrl}/api/incidents/${spoofInc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({ status: 'INVESTIGATING', note: 'SOC reviewing synthetic audio artifact' }),
    });
    assert.equal(adminPatch.status, 200);
    assert.equal((await adminPatch.json()).incident.status, 'INVESTIGATING');

    // 4. Break-Glass registry: requires SECOPS_ADMIN, 2 distinct custodians, runbook ack, and bounded TTL
    const nonAdminBg = await fetch(`${baseUrl}/api/break-glass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        ticketId: 'INC-9001',
        justification: 'IdP cluster unreachable in production region',
        targetScope: 'aws.iam.role/EmergencyBreakout',
        custodians: ['sarah.jenkins@acme.corp', 'marcus.vance@acme.corp'],
        ttlMinutes: 45,
        acknowledgedRunbook: true,
      }),
    });
    assert.equal(nonAdminBg.status, 403);

    const singleCustodianBg = await fetch(`${baseUrl}/api/break-glass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({
        ticketId: 'INC-9001',
        justification: 'IdP cluster unreachable in production region',
        targetScope: 'aws.iam.role/EmergencyBreakout',
        custodians: ['marcus.vance@acme.corp', 'marcus.vance@acme.corp'],
        ttlMinutes: 45,
        acknowledgedRunbook: true,
      }),
    });
    assert.equal(singleCustodianBg.status, 403);

    const validBg = await fetch(`${baseUrl}/api/break-glass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({
        ticketId: 'INC-9001',
        justification: 'IdP cluster unreachable; verified out-of-band with dual custodians.',
        targetScope: 'aws.iam.role/EmergencyBreakout',
        custodians: ['marcus.vance@acme.corp', 'sarah.jenkins@acme.corp'],
        ttlMinutes: 45,
        acknowledgedRunbook: true,
      }),
    });
    assert.equal(validBg.status, 201);
    const { event: bgEvent } = await validBg.json();
    assert.equal(bgEvent.ticketId, 'INC-9001');
    assert.equal(bgEvent.custodians.length, 2);

    const bgList = await (await fetch(`${baseUrl}/api/break-glass`, { headers: { Cookie: sarahCookie } })).json();
    assert.equal(bgList.events.length, 1);

    // 5. Verify append-only SHA-256 audit chain integrity via HTTP endpoint
    const chainRes = await fetch(`${baseUrl}/api/audit-events/verify-chain`, {
      headers: { Cookie: marcusCookie },
    });
    assert.equal(chainRes.status, 200);
    const chainBody = await chainRes.json();
    assert.equal(chainBody.valid, true);
    assert.ok(chainBody.verifiedCount >= 5);
    assert.equal(chainBody.verifiedCount, chainBody.totalCount);

    // Tamper directly with DB payload_json and assert verifyAuditChain detects the exact broken row
    const headEvent = db
      .prepare("SELECT id FROM audit_events WHERE organisation_id = 'org_acme_enterprise' ORDER BY rowid DESC LIMIT 1")
      .get();
    db.prepare('UPDATE audit_events SET payload_json = ? WHERE id = ?').run('{"tampered":true}', headEvent.id);
    const tamperedCheck = verifyAuditChain(db, 'org_acme_enterprise');
    assert.equal(tamperedCheck.valid, false);
    assert.equal(tamperedCheck.brokenAtId, headEvent.id);
    assert.equal(tamperedCheck.reason, 'event_hash_mismatch');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
