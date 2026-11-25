import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { createGitHubAppJwt, verifyGitHubWebhookSignature } from '../crypto.mjs';
import { parseDetectifAiVerifyResponse } from '../detectifai.mjs';
import { parseGitHubCallbackUrl } from '../services/githubAppService.mjs';

const { privateKey: TEST_RSA_PRIV, publicKey: TEST_RSA_PUB } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

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
    github: {
      appId: '998877',
      privateKey: TEST_RSA_PRIV,
      webhookSecret: 'gh_test_secret_123',
    },
    webauthn: { rpId: 'localhost', rpName: 'ACTIONLOCK Enterprise', origin: 'http://localhost:5173' },
  };
}

function signGitHubPayload(secret, rawBody) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
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

test('Phase 7 unit: GitHub X-Hub-Signature-256 verification, RS256 App JWT signing, and SSRF callback validation', () => {
  const secret = 'gh_whsec_unit';
  const body = Buffer.from('{"hello":"world"}', 'utf8');
  const sig = signGitHubPayload(secret, body);

  assert.equal(verifyGitHubWebhookSignature({ secret, signatureHeader: sig, rawBody: body }).valid, true);
  assert.equal(
    verifyGitHubWebhookSignature({
      secret,
      signatureHeader: sig,
      rawBody: Buffer.from('{"hello":"tampered"}', 'utf8'),
    }).valid,
    false,
  );
  assert.equal(verifyGitHubWebhookSignature({ secret, signatureHeader: 'sha1=bad', rawBody: body }).valid, false);
  assert.equal(verifyGitHubWebhookSignature({ secret: '', signatureHeader: sig, rawBody: body }).valid, false);

  const jwt = createGitHubAppJwt({ appId: '998877', privateKeyPem: TEST_RSA_PRIV });
  const [hdrB64, payB64, jwtSigB64] = jwt.split('.');
  const header = JSON.parse(Buffer.from(hdrB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payB64, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.iss, '998877');
  assert.ok(payload.exp - payload.iat <= 600);
  const sigValid = crypto
    .createVerify('RSA-SHA256')
    .update(`${hdrB64}.${payB64}`)
    .verify(TEST_RSA_PUB, Buffer.from(jwtSigB64, 'base64url'));
  assert.equal(sigValid, true);

  const parsed = parseGitHubCallbackUrl(
    'https://api.github.com/repos/acme-org/checkout/actions/runs/55443322/deployment_protection_rule',
  );
  assert.equal(parsed.owner, 'acme-org');
  assert.equal(parsed.repo, 'checkout');
  assert.equal(parsed.runId, '55443322');

  assert.throws(() => parseGitHubCallbackUrl('http://api.github.com/repos/a/b/actions/runs/1/deployment_protection_rule'));
  assert.throws(() => parseGitHubCallbackUrl('https://evil.example.com/repos/a/b/actions/runs/1/deployment_protection_rule'));
});

test('Phase 7 integration: GitHub webhook ingestion, full authorization release callback, replay rejection, and explicit reject callback', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  let lastPhrase = '';
  const postedCallbacks = [];
  let tokenExchangeCount = 0;

  const server = createApp({
    db,
    config,
    speakerProvider: {
      enroll: async ({ speakerId }) => ({ ok: true, data: { operation_id: 'op_enr_p7', speaker_id: speakerId } }),
    },
    sttProvider: async () => ({ ok: true, transcript: lastPhrase }),
    verifyProvider: async () => {
      const raw = {
        operation_id: 'op_eidos_p7',
        result: { decision: 'match', similarity: 0.94, duration_seconds: 12.0 },
        deepfake: { operation_id: 'op_aletheia_p7', verdict: 'real', score: 0.03 },
      };
      return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
    },
    webauthnProvider: {
      verifyRegistration: async () => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred_p7_sarah',
            publicKey: new Uint8Array([9, 8, 7, 6]),
            counter: 0,
            transports: ['internal'],
          },
        },
      }),
      verifyAuthentication: async () => ({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      }),
    },
    githubProvider: {
      exchangeToken: async ({ config: cfg, installationId }) => {
        // Prove RS256 GitHub App JWT can actually be constructed from cfg
        const appJwt = createGitHubAppJwt({ appId: cfg.github.appId, privateKeyPem: cfg.github.privateKey });
        assert.equal(appJwt.split('.').length, 3);
        tokenExchangeCount += 1;
        return { token: `ghs_mock_inst_${installationId}_${tokenExchangeCount}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
      },
      postDecision: async (args) => {
        postedCallbacks.push(args);
        return { ok: true, status: 204, url: args.callbackUrl, state: args.state, body: {} };
      },
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Forged GitHub webhook signature must be rejected (401)
    const whPayload = {
      environment: 'production',
      event: 'workflow_dispatch',
      deployment_callback_url: 'https://api.github.com/repos/acme-org/payments/actions/runs/91827364/deployment_protection_rule',
      deployment: { id: 1001, sha: 'abc123def456', creator: { login: 'alex-chen' } },
      repository: { name: 'payments', owner: { login: 'acme-org' } },
      installation: { id: 445566 },
      sender: { login: 'alex-chen' },
    };
    const whRaw = Buffer.from(JSON.stringify(whPayload), 'utf8');

    const badSigRes = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'deployment_protection_rule',
        'X-GitHub-Delivery': 'deliv-1',
        'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64),
      },
      body: whRaw,
    });
    assert.equal(badSigRes.status, 401);

    // 2. Signed ping webhook succeeds
    const pingRaw = Buffer.from(JSON.stringify({ zen: 'Keep it safe' }), 'utf8');
    const pingRes = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-GitHub-Delivery': 'deliv-ping-1',
        'X-Hub-Signature-256': signGitHubPayload(config.github.webhookSecret, pingRaw),
      },
      body: pingRaw,
    });
    assert.equal(pingRes.status, 200);

    // 3. Signed deployment_protection_rule creates correlated PENDING action envelope
    const goodSig = signGitHubPayload(config.github.webhookSecret, whRaw);
    const whRes = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'deployment_protection_rule',
        'X-GitHub-Delivery': 'deliv-1',
        'X-Hub-Signature-256': goodSig,
      },
      body: whRaw,
    });
    assert.equal(whRes.status, 200);
    const whBody = await whRes.json();
    assert.equal(whBody.accepted, true);
    assert.equal(whBody.deduplicated, false);
    assert.equal(whBody.createdNewAction, true);
    assert.equal(whBody.state, 'PENDING');
    const actionId = whBody.actionId;

    // Duplicate delivery is deduplicated cleanly
    const dupRes = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'deployment_protection_rule',
        'X-GitHub-Delivery': 'deliv-1',
        'X-Hub-Signature-256': goodSig,
      },
      body: whRaw,
    });
    assert.equal(dupRes.status, 200);
    assert.equal((await dupRes.json()).deduplicated, true);

    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');
    const marcusCookie = await loginAs(baseUrl, 'marcus.vance@acme.corp');

    // Integrations endpoint reports configured + delivery count
    const intRes = await fetch(`${baseUrl}/api/integrations`, { headers: { Cookie: sarahCookie } });
    assert.equal(intRes.status, 200);
    const intBody = await intRes.json();
    assert.equal(intBody.github.status, 'CONNECTED');
    assert.equal(intBody.github.webhookDeliveryCount, 2);

    // 4. Releasing GitHub callback without a valid scoped token is blocked (403)
    const noTokenCb = await fetch(`${baseUrl}/api/actions/${actionId}/github-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ decision: 'approved' }),
    });
    assert.equal(noTokenCb.status, 403);
    assert.equal(postedCallbacks.length, 0);

    // 5. Complete enrollment, voice challenge, passkey registration/auth, peer approval, and scoped token
    const sampleAudio = Buffer.alloc(4096, 4).toString('base64');
    const enrRes = await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        userId: 'usr_sarah_jenkins',
        audioBase64: sampleAudio,
        mimeType: 'audio/wav',
        durationSeconds: 32,
        consentAccepted: true,
        retentionAcknowledged: true,
      }),
    });
    assert.equal(enrRes.status, 201);

    await fetch(`${baseUrl}/api/webauthn/register/options`, { method: 'POST', headers: { Cookie: sarahCookie } });
    const regVerRes = await fetch(`${baseUrl}/api/webauthn/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ response: { id: 'cred_p7_sarah', response: {} } }),
    });
    assert.equal(regVerRes.status, 201);

    const chRes = await fetch(`${baseUrl}/api/actions/${actionId}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({}),
    });
    assert.equal(chRes.status, 201);
    lastPhrase = (await chRes.json()).challenge.phrase;

    const recRes = await fetch(`${baseUrl}/api/actions/${actionId}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/wav',
        durationSeconds: 11,
        idempotencyKey: 'idem_p7_1',
      }),
    });
    assert.equal(recRes.status, 200);

    await fetch(`${baseUrl}/api/actions/${actionId}/passkey/options`, { method: 'POST', headers: { Cookie: sarahCookie } });
    const pkVerRes = await fetch(`${baseUrl}/api/actions/${actionId}/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ response: { id: 'cred_p7_sarah', response: {} } }),
    });
    assert.equal(pkVerRes.status, 200);

    const peerRes = await fetch(`${baseUrl}/api/actions/${actionId}/peer-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({ decision: 'APPROVED', reason: 'Peer checked run 91827364' }),
    });
    assert.equal(peerRes.status, 200);

    const approveRes = await fetch(`${baseUrl}/api/actions/${actionId}/approve`, {
      method: 'POST',
      headers: { Cookie: sarahCookie },
    });
    assert.equal(approveRes.status, 200);
    const { permit } = await approveRes.json();

    // 6. Execute approved GitHub deployment protection callback using scoped permit token
    const releaseRes = await fetch(`${baseUrl}/api/actions/${actionId}/github-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        decision: 'approved',
        permitToken: permit.token,
        comment: 'Voice + Passkey + Peer SoD verified',
      }),
    });
    assert.equal(releaseRes.status, 200);
    const releaseBody = await releaseRes.json();
    assert.equal(releaseBody.ok, true);
    assert.equal(releaseBody.decision, 'approved');
    assert.equal(releaseBody.githubStatus, 204);
    assert.equal(postedCallbacks.length, 1);
    assert.equal(postedCallbacks[0].state, 'approved');
    assert.equal(postedCallbacks[0].environmentName, 'production');
    assert.equal(postedCallbacks[0].owner, 'acme-org');
    assert.equal(postedCallbacks[0].repo, 'payments');
    assert.equal(postedCallbacks[0].runId, '91827364');

    // Action must now be CONSUMED
    const detailRes = await fetch(`${baseUrl}/api/actions/${actionId}`, { headers: { Cookie: sarahCookie } });
    assert.equal((await detailRes.json()).action.state, 'CONSUMED');

    // Replaying the same permit token on github-callback must return 409 and NOT invoke GitHub
    const replayCb = await fetch(`${baseUrl}/api/actions/${actionId}/github-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ decision: 'approved', permitToken: permit.token }),
    });
    assert.equal(replayCb.status, 409);
    assert.equal(postedCallbacks.length, 1);

    // 7. Rejection path: ingest a second GitHub webhook and explicitly post "rejected"
    const wh2Payload = {
      ...whPayload,
      deployment_callback_url: 'https://api.github.com/repos/acme-org/payments/actions/runs/91827999/deployment_protection_rule',
    };
    const wh2Raw = Buffer.from(JSON.stringify(wh2Payload), 'utf8');
    const wh2Res = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'deployment_protection_rule',
        'X-GitHub-Delivery': 'deliv-2',
        'X-Hub-Signature-256': signGitHubPayload(config.github.webhookSecret, wh2Raw),
      },
      body: wh2Raw,
    });
    const actionId2 = (await wh2Res.json()).actionId;

    const rejectCb = await fetch(`${baseUrl}/api/actions/${actionId2}/github-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({ decision: 'rejected', comment: 'Commit SHA unapproved for production freeze' }),
    });
    assert.equal(rejectCb.status, 200);
    assert.equal(postedCallbacks.length, 2);
    assert.equal(postedCallbacks[1].state, 'rejected');
    assert.equal(postedCallbacks[1].runId, '91827999');

    const detail2 = await (await fetch(`${baseUrl}/api/actions/${actionId2}`, { headers: { Cookie: marcusCookie } })).json();
    assert.equal(detail2.action.state, 'REJECTED');

    // Audit trail must record GITHUB_DEPLOYMENT_RELEASED and GITHUB_DEPLOYMENT_REJECTED
    const auditEvents = (await (await fetch(`${baseUrl}/api/audit-events`, { headers: { Cookie: sarahCookie } })).json()).events;
    assert.ok(auditEvents.some((e) => e.eventType === 'GITHUB_DEPLOYMENT_RELEASED' && e.actionRequestId === actionId));
    assert.ok(auditEvents.some((e) => e.eventType === 'GITHUB_DEPLOYMENT_REJECTED' && e.actionRequestId === actionId2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
