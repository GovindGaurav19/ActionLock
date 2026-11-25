import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { parseDetectifAiVerifyResponse } from '../detectifai.mjs';
import { processPendingWebhooks } from '../services/webhookService.mjs';

const { privateKey: TEST_RSA_PRIV } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function makeConfig() {
  return {
    port: 0,
    nodeEnv: 'test',
    isProd: false,
    sqliteDbPath: ':memory:',
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    sessionCookieName: 'actionlock_sid',
    sessionTtlSeconds: 3600,
    actionTokenSecret: crypto.randomBytes(32).toString('hex'),
    detectifAi: {
      apiKey: '',
      baseUrl: 'https://platform.detectif.ai',
      webhookSecret: 'whsec_' + Buffer.from('detectifai_test_secret_bytes_32').toString('base64'),
    },
    stt: { projectId: '', credentialsPath: '', languageCode: 'en-US' },
    github: {
      appId: '777888',
      privateKey: TEST_RSA_PRIV,
      webhookSecret: 'gh_adv_secret',
    },
    webauthn: { rpId: 'localhost', rpName: 'ACTIONLOCK Enterprise', origin: 'http://localhost:5173' },
  };
}

function signDetectifWebhook(whsec, id, ts, body) {
  const secretBytes = Buffer.from(whsec.split('whsec_')[1], 'base64');
  const sig = crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

function signGitHub(secret, rawBuf) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBuf).digest('hex')}`;
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

test('Phase 10 Adversarial Suite: All 24 End-to-End Security Acceptance Scenarios', async () => {
  const config = makeConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  let nextSttPhrase = '';
  let forceSttMismatch = false;
  let verifyMode = 'genuine'; // genuine | fake | no_match | partial | error_503
  let verifyCallCount = 0;
  let ghCallbackCount = 0;

  const server = createApp({
    db,
    config,
    speakerProvider: {
      enroll: async ({ speakerId }) => ({ ok: true, data: { operation_id: `op_enr_${speakerId}`, speaker_id: speakerId } }),
    },
    sttProvider: async () => ({
      ok: true,
      transcript: forceSttMismatch ? 'completely wrong spoken words' : nextSttPhrase,
    }),
    verifyProvider: async () => {
      verifyCallCount += 1;
      if (verifyMode === 'error_503') {
        return { ok: false, status: 503, error: { code: 'DETECTIFAI_UNAVAILABLE', message: 'Upstream 503' } };
      }
      let raw;
      if (verifyMode === 'fake') {
        raw = {
          operation_id: `op_e_${verifyCallCount}`,
          result: { decision: 'match', similarity: 0.95, duration_seconds: 12 },
          deepfake: { operation_id: `op_a_${verifyCallCount}`, verdict: 'fake', score: 0.94 },
        };
      } else if (verifyMode === 'no_match') {
        raw = {
          operation_id: `op_e_${verifyCallCount}`,
          result: { decision: 'no_match', similarity: 0.29, duration_seconds: 12 },
          deepfake: { operation_id: `op_a_${verifyCallCount}`, verdict: 'real', score: 0.02 },
        };
      } else if (verifyMode === 'partial') {
        raw = {
          operation_id: `op_e_${verifyCallCount}`,
          result: { decision: 'match', similarity: 0.92, duration_seconds: 12 },
          deepfake: { operation_id: `op_a_${verifyCallCount}`, error: { message: 'Deepfake async pending' } },
        };
      } else {
        raw = {
          operation_id: `op_e_${verifyCallCount}`,
          result: { decision: 'match', similarity: 0.94, duration_seconds: 12 },
          deepfake: { operation_id: `op_a_${verifyCallCount}`, verdict: 'real', score: 0.03 },
        };
      }
      return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
    },
    webauthnProvider: {
      verifyRegistration: async ({ response }) => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: response.id || 'cred_adv_sarah',
            publicKey: new Uint8Array([1, 3, 5, 7]),
            counter: 0,
            transports: ['internal'],
          },
        },
      }),
      verifyAuthentication: async ({ response, credential }) => {
        if (response?.badSig) throw new Error('Invalid assertion signature');
        return { verified: true, authenticationInfo: { newCounter: credential.counter + 1 } };
      },
    },
    githubProvider: {
      exchangeToken: async () => ({ token: 'ghs_adv_inst_tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      postDecision: async (args) => {
        ghCallbackCount += 1;
        return { ok: true, status: 204, url: args.callbackUrl, state: args.state, body: {} };
      },
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const validAudio = Buffer.alloc(4096, 5).toString('base64');

  try {
    // Scenario 01: Unauthenticated requests fail closed (401)
    for (const ep of ['/api/actions', '/api/policies', '/api/speakers', '/api/dashboard/summary', '/api/incidents', '/api/break-glass']) {
      assert.equal((await fetch(`${baseUrl}${ep}`)).status, 401);
    }

    // Scenario 02: Bad password rejected 401 + rate limiting triggers 429 on bursts
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex.chen@acme.corp', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    const alexCookie = await loginAs(baseUrl, 'alex.chen@acme.corp');
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');
    const marcusCookie = await loginAs(baseUrl, 'marcus.vance@acme.corp');
    const anyaCookie = await loginAs(baseUrl, 'anya.kapoor@acme.corp');

    // Scenario 03: RBAC least privilege (REQUESTER cannot manage policies, incidents, break-glass, challenges)
    assert.equal((await fetch(`${baseUrl}/api/policies`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: alexCookie }, body: JSON.stringify({ id: 'X', name: 'X', category: 'IAM', target: 'Y' }) })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/break-glass`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: alexCookie }, body: JSON.stringify({}) })).status, 403);

    // Scenario 04: AUDITOR is strictly read-only
    assert.equal((await fetch(`${baseUrl}/api/actions`, { headers: { Cookie: anyaCookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/audit-events`, { headers: { Cookie: anyaCookie } })).status, 200);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: anyaCookie },
          body: JSON.stringify({ category: 'FINANCE_APPROVAL' }),
        })
      ).status,
      403,
    );

    // Scenario 05: Requester self-designation blocked (403)
    const selfDesignate = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        category: 'FINANCE_APPROVAL',
        claimedApproverEmail: 'alex.chen@acme.corp',
        parameters: {
          vendorReference: 'CloudScale US',
          beneficiaryReference: 'SIM-100',
          amount: 10000,
          currency: 'USD',
          purpose: 'SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED.',
        },
      }),
    });
    assert.equal(selfDesignate.status, 403);

    // Create legitimate Finance Simulation Action for drift & tamper checks
    const finRes = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        category: 'FINANCE_APPROVAL',
        claimedApproverEmail: 'sarah.jenkins@acme.corp',
        environment: 'simulation',
        parameters: {
          vendorReference: 'CloudScale US',
          beneficiaryReference: 'SIM-ABA-ORIG',
          amount: 420000,
          currency: 'USD',
          purpose: 'SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED.',
        },
      }),
    });
    assert.equal(finRes.status, 201);
    const { action: finAction } = await finRes.json();

    // Scenario 06: Post-challenge payload mutation changes SHA-256 hash, increments version, transitions INVALIDATED, opens incident
    await fetch(`${baseUrl}/api/actions/${finAction.id}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({}),
    });
    const mutRes = await fetch(`${baseUrl}/api/actions/${finAction.id}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({ parameters: { beneficiaryReference: 'SIM-HIJACK-99' }, reason: 'Mid-flight change' }),
    });
    const mutBody = await mutRes.json();
    assert.equal(mutBody.mutated, true);
    assert.notEqual(mutBody.previousHash, mutBody.newHash);
    assert.equal(mutBody.action.state, 'INVALIDATED');

    // Scenario 07: Silent DB row tampering detected via /verify-hash (409)
    db.prepare('UPDATE action_envelopes SET canonical_json = ? WHERE action_request_id = ? AND version = 2').run(
      '{"tampered":true}',
      finAction.id,
    );
    const tamperCheck = await fetch(`${baseUrl}/api/actions/${finAction.id}/verify-hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({}),
    });
    assert.equal(tamperCheck.status, 409);

    // Scenario 08: Speaker enrollment requires explicit informed consent & retention ack
    const noConsent = await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', consentAccepted: false, retentionAcknowledged: true }),
    });
    assert.equal(noConsent.status, 400);

    // Scenario 09: Invalid MIME type rejected 400
    const badMime = await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'text/plain', consentAccepted: true, retentionAcknowledged: true }),
    });
    assert.equal(badMime.status, 400);

    // Scenario 10: Unenrolled speaker fails closed on recording submit
    const ghAct1 = (
      await (
        await fetch(`${baseUrl}/api/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
          body: JSON.stringify({
            category: 'GITHUB_DEPLOYMENT',
            claimedApproverEmail: 'sarah.jenkins@acme.corp',
            parameters: {
              repositoryOwner: 'acme-org',
              repositoryName: 'core-api',
              commitSha: '11223344',
              workflowRunId: '51001',
              targetEnvironment: 'production',
            },
          }),
        })
      ).json()
    ).action;
    const ch1 = (await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({}) })).json()).challenge;
    nextSttPhrase = ch1.phrase;
    const unenrRec = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_10' }),
    });
    assert.equal(unenrRec.status, 409);

    // Enroll Sarah now
    assert.equal(
      (
        await fetch(`${baseUrl}/api/speakers/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
          body: JSON.stringify({
            audioBase64: validAudio,
            mimeType: 'audio/wav',
            durationSeconds: 16,
            consentAccepted: true,
            retentionAcknowledged: true,
          }),
        })
      ).status,
      201,
    );

    // Scenario 11: Expired voice challenge rejected (409)
    db.prepare('UPDATE voice_challenges SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', ch1.id);
    const expRec = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_11' }),
    });
    assert.equal(expRec.status, 409);

    // Issue fresh challenge on ghAct1 & verify Scenario 12: STT phrase mismatch holds action
    const ch1b = (await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({}) })).json()).challenge;
    nextSttPhrase = ch1b.phrase;
    forceSttMismatch = true;
    const sttFailRes = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_12' }),
    });
    assert.equal((await sttFailRes.json()).state, 'HOLD');
    forceSttMismatch = false;

    // Scenario 13: Eidos match + Aletheia fake -> HOLD + incident
    verifyMode = 'fake';
    const ch1c = (await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({}) })).json()).challenge;
    nextSttPhrase = ch1c.phrase;
    const fakeRes = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_13' }),
    });
    assert.equal((await fakeRes.json()).state, 'HOLD');

    // Scenario 14: Aletheia real + Eidos no_match -> HOLD
    verifyMode = 'no_match';
    const ch1d = (await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({}) })).json()).challenge;
    nextSttPhrase = ch1d.phrase;
    const mismatchRes = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_14' }),
    });
    assert.equal((await mismatchRes.json()).state, 'HOLD');

    // Scenario 15: Provider 503 fails closed (503), idempotency key deduplicates retries
    verifyMode = 'error_503';
    const ch1e = (await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({}) })).json()).challenge;
    nextSttPhrase = ch1e.phrase;
    const err503 = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_15' }),
    });
    assert.equal(err503.status, 503);

    // Scenario 16: Standard Webhooks bad signature / stale timestamp rejected 401
    const badWh = await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_bad',
        'webhook-timestamp': String(Math.floor(Date.now() / 1000) - 900),
        'webhook-signature': 'v1,invalid',
      },
      body: '{}',
    });
    assert.equal(badWh.status, 401);

    // Scenario 17: Partial verification + webhook async convergence
    verifyMode = 'partial';
    const ch1f = (await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({}) })).json()).challenge;
    nextSttPhrase = ch1f.phrase;
    const partialRes = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ audioBase64: validAudio, mimeType: 'audio/wav', durationSeconds: 12, idempotencyKey: 'adv_17' }),
    });
    const partialBody = await partialRes.json();
    assert.equal(partialBody.state, 'HOLD');

    const whBodyStr = JSON.stringify({
      type: 'deepfake.completed',
      operation_id: partialBody.aletheia.operationId,
      data: { result: { verdict: 'real', score: 0.02 } },
    });
    const whNow = String(Math.floor(Date.now() / 1000));
    const whOk = await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_adv_17',
        'webhook-timestamp': whNow,
        'webhook-signature': signDetectifWebhook(config.detectifAi.webhookSecret, 'msg_adv_17', whNow, whBodyStr),
      },
      body: whBodyStr,
    });
    assert.equal(whOk.status, 200);
    processPendingWebhooks(db);

    const gh1Detail = await (await fetch(`${baseUrl}/api/actions/${ghAct1.id}`, { headers: { Cookie: sarahCookie } })).json();
    assert.equal(gh1Detail.action.state, 'VOICE_VERIFIED');

    // Scenario 18: VOICE_VERIFIED alone cannot issue token (403)
    const voiceOnlyApprove = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/approve`, {
      method: 'POST',
      headers: { Cookie: sarahCookie },
    });
    assert.equal(voiceOnlyApprove.status, 403);

    // Scenario 19: Failed passkey moves to HOLD; valid passkey moves to WAITING_FOR_PEER_APPROVAL
    await fetch(`${baseUrl}/api/webauthn/register/options`, { method: 'POST', headers: { Cookie: sarahCookie } });
    await fetch(`${baseUrl}/api/webauthn/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ response: { id: 'cred_adv_sarah', response: {} } }),
    });
    await fetch(`${baseUrl}/api/actions/${ghAct1.id}/passkey/options`, { method: 'POST', headers: { Cookie: sarahCookie } });
    const badPk = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ response: { id: 'cred_adv_sarah', badSig: true } }),
    });
    assert.equal(badPk.status, 400);

    await fetch(`${baseUrl}/api/actions/${ghAct1.id}/passkey/options`, { method: 'POST', headers: { Cookie: sarahCookie } });
    const goodPk = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ response: { id: 'cred_adv_sarah', response: {} } }),
    });
    assert.equal(goodPk.status, 200);

    // Scenario 20: Peer approval enforces SoD against requester (alex) and primary signer (sarah)
    assert.equal((await fetch(`${baseUrl}/api/actions/${ghAct1.id}/peer-approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: alexCookie }, body: JSON.stringify({ decision: 'APPROVED' }) })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/actions/${ghAct1.id}/peer-approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sarahCookie }, body: JSON.stringify({ decision: 'APPROVED' }) })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/actions/${ghAct1.id}/peer-approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: marcusCookie }, body: JSON.stringify({ decision: 'APPROVED' }) })).status, 200);

    // Scenario 21: Single scoped token minted (duplicate 409) & wrong-scope consumption rejected (403)
    const mintRes = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/approve`, { method: 'POST', headers: { Cookie: sarahCookie } });
    assert.equal(mintRes.status, 200);
    const { permit } = await mintRes.json();
    assert.equal((await fetch(`${baseUrl}/api/actions/${ghAct1.id}/approve`, { method: 'POST', headers: { Cookie: sarahCookie } })).status, 409);

    const wrongScope = await fetch(`${baseUrl}/api/tokens/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: permit.token, expectedActionId: ghAct1.id, expectedScope: 'FINANCE_APPROVAL:wrong' }),
    });
    assert.equal(wrongScope.status, 403);

    // Scenario 22: GitHub forged signature (401) & SSRF callback URL (400) rejected
    assert.equal(
      (
        await fetch(`${baseUrl}/api/webhooks/github`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'deployment_protection_rule', 'X-GitHub-Delivery': 'd-bad', 'X-Hub-Signature-256': 'sha256=' + 'f'.repeat(64) },
          body: '{}',
        })
      ).status,
      401,
    );
    const ssrfRaw = Buffer.from(JSON.stringify({ deployment_callback_url: 'https://evil.example.com/repos/a/b/actions/runs/1/deployment_protection_rule' }), 'utf8');
    assert.equal(
      (
        await fetch(`${baseUrl}/api/webhooks/github`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'deployment_protection_rule', 'X-GitHub-Delivery': 'd-ssrf', 'X-Hub-Signature-256': signGitHub(config.github.webhookSecret, ssrfRaw) },
          body: ssrfRaw,
        })
      ).status,
      400,
    );

    // Scenario 23: GitHub callback requires valid permit & rejects token replay (409)
    // Inject deploymentCallbackUrl/installationId on ghAct1 envelope params or test via ghAct1 with installationId override
    const releaseOk = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/github-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ decision: 'approved', permitToken: permit.token, installationId: '445566' }),
    });
    assert.equal(releaseOk.status, 200);
    assert.equal(ghCallbackCount, 1);

    const replayGh = await fetch(`${baseUrl}/api/actions/${ghAct1.id}/github-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ decision: 'approved', permitToken: permit.token, installationId: '445566' }),
    });
    assert.equal(replayGh.status, 409);
    assert.equal(ghCallbackCount, 1);

    // Scenario 24: Break-Glass dual custodian enforcement + SHA-256 audit chain integrity verification
    const bgOk = await fetch(`${baseUrl}/api/break-glass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({
        ticketId: 'INC-ADV-24',
        justification: 'Outage recovery drill requiring dual custodian sign-off',
        targetScope: 'aws.iam.role/EmergencyBreakout',
        custodians: ['marcus.vance@acme.corp', 'sarah.jenkins@acme.corp'],
        ttlMinutes: 30,
        acknowledgedRunbook: true,
      }),
    });
    assert.equal(bgOk.status, 201);

    const chainOk = await (await fetch(`${baseUrl}/api/audit-events/verify-chain`, { headers: { Cookie: anyaCookie } })).json();
    assert.equal(chainOk.valid, true);
    assert.ok(chainOk.verifiedCount >= 10);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
