import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { parseDetectifAiVerifyResponse } from '../detectifai.mjs';
import { evaluateActionPolicy } from '../services/policyEngineService.mjs';

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

test('Phase 6: deterministic policy engine, WebAuthn registration/auth, peer SoD, and atomic one-time scoped token', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  let lastPhrase = '';
  let regCounter = 0;

  const server = createApp({
    db,
    config,
    speakerProvider: {
      enroll: async ({ speakerId }) => ({ ok: true, data: { operation_id: 'op_enr_p6', speaker_id: speakerId } }),
    },
    sttProvider: async () => ({ ok: true, transcript: lastPhrase }),
    verifyProvider: async () => {
      const raw = {
        operation_id: 'op_eidos_p6',
        result: { decision: 'match', similarity: 0.95, duration_seconds: 12.0 },
        deepfake: { operation_id: 'op_aletheia_p6', verdict: 'real', score: 0.02 },
      };
      return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
    },
    webauthnProvider: {
      verifyRegistration: async ({ response, expectedChallenge, expectedOrigin, expectedRPID }) => {
        assert.equal(expectedOrigin, 'http://localhost:5173');
        assert.equal(expectedRPID, 'localhost');
        assert.ok(expectedChallenge);
        regCounter += 1;
        return {
          verified: Boolean(response?.id && response?.attestationObject),
          registrationInfo: {
            aaguid: '00000000-0000-0000-0000-000000000000',
            credential: {
              id: response.id,
              publicKey: new Uint8Array([1, 2, 3, 4, regCounter]),
              counter: 0,
              transports: ['internal'],
            },
          },
        };
      },
      verifyAuthentication: async ({ response, expectedChallenge, expectedOrigin, expectedRPID, credential }) => {
        assert.equal(expectedOrigin, 'http://localhost:5173');
        assert.equal(expectedRPID, 'localhost');
        assert.ok(expectedChallenge);
        if (response?.simulateBadSignature) {
          throw new Error('Signature verification failed');
        }
        return {
          verified: true,
          authenticationInfo: {
            credentialID: credential.id,
            newCounter: credential.counter + 1,
            userVerified: true,
          },
        };
      },
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

    // 1. Policies API: seeded policies readable; non-admin cannot create; admin can create & audit
    const polList = await (await fetch(`${baseUrl}/api/policies`, { headers: { Cookie: sarahCookie } })).json();
    assert.ok(polList.policies.some((p) => p.id === 'SEC-POL-04'));

    const nonAdminPol = await fetch(`${baseUrl}/api/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ id: 'POL-X', name: 'Test', category: 'IAM', target: 'Okta' }),
    });
    assert.equal(nonAdminPol.status, 403);

    const adminPol = await fetch(`${baseUrl}/api/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({ id: 'SEC-POL-99', name: 'Test Rule', category: 'IAM', target: 'Okta' }),
    });
    assert.equal(adminPol.status, 201);

    // 2. Enroll Sarah's voice + register Sarah's WebAuthn passkey
    await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 20,
        consentAccepted: true,
        retentionAcknowledged: true,
      }),
    });

    const regOpts = await (
      await fetch(`${baseUrl}/api/webauthn/register/options`, { method: 'POST', headers: { Cookie: sarahCookie } })
    ).json();
    assert.ok(regOpts.challenge);
    const regVer = await fetch(`${baseUrl}/api/webauthn/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ id: 'cred_sarah_1', attestationObject: 'mock_att' }),
    });
    assert.equal(regVer.status, 201);

    // 3. Alex creates GitHub production action -> Sarah passes voice challenge
    const { action } = await (
      await fetch(`${baseUrl}/api/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
        body: JSON.stringify({
          category: 'GITHUB_DEPLOYMENT',
          claimedApproverEmail: 'sarah.jenkins@acme.corp',
          parameters: {
            repositoryOwner: 'acme-corp',
            repositoryName: 'core-auth-gateway',
            commitSha: '9988aabb',
            workflowRunId: '6001',
            targetEnvironment: 'production-us-east-1',
          },
        }),
      })
    ).json();

    const { challenge } = await (
      await fetch(`${baseUrl}/api/actions/${action.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({}),
      })
    ).json();
    lastPhrase = challenge.phrase;

    await fetch(`${baseUrl}/api/actions/${action.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ challengeId: challenge.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
    });

    // Voice verified alone MUST NOT allow token issuance
    const prematureApprove = await fetch(`${baseUrl}/api/actions/${action.id}/approve`, {
      method: 'POST',
      headers: { Cookie: sarahCookie },
    });
    assert.equal(prematureApprove.status, 403);

    const evalAfterVoice = evaluateActionPolicy({ db, actionRequestId: action.id });
    assert.equal(evalAfterVoice.decision, 'HOLD');
    assert.ok(evalAfterVoice.missingFactors.includes('PASSKEY_VERIFICATION'));
    assert.ok(evalAfterVoice.missingFactors.includes('PEER_APPROVAL'));

    // 4. WebAuthn failure holds action; valid retry succeeds and moves to WAITING_FOR_PEER_APPROVAL
    await fetch(`${baseUrl}/api/actions/${action.id}/passkey/options`, {
      method: 'POST',
      headers: { Cookie: sarahCookie },
    });
    const badAuth = await fetch(`${baseUrl}/api/actions/${action.id}/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ id: 'cred_sarah_1', simulateBadSignature: true }),
    });
    assert.equal(badAuth.status, 400);

    await fetch(`${baseUrl}/api/actions/${action.id}/passkey/options`, {
      method: 'POST',
      headers: { Cookie: sarahCookie },
    });
    const goodAuth = await fetch(`${baseUrl}/api/actions/${action.id}/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ id: 'cred_sarah_1' }),
    });
    assert.equal(goodAuth.status, 200);
    const goodAuthJson = await goodAuth.json();
    assert.equal(goodAuthJson.state, 'WAITING_FOR_PEER_APPROVAL');

    // 5. Self-peer-approval by Alex (requester) or Sarah (passkey signer) rejected with 403
    const alexPeer = await fetch(`${baseUrl}/api/actions/${action.id}/peer-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.equal(alexPeer.status, 403);

    const sarahPeer = await fetch(`${baseUrl}/api/actions/${action.id}/peer-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.equal(sarahPeer.status, 403);

    // Distinct peer Marcus approves -> APPROVED!
    const marcusPeer = await fetch(`${baseUrl}/api/actions/${action.id}/peer-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marcusCookie },
      body: JSON.stringify({ decision: 'APPROVED', reason: 'Verified commit SHA and dual AI' }),
    });
    assert.equal(marcusPeer.status, 200);
    assert.equal((await marcusPeer.json()).state, 'APPROVED');

    // 6. Issue scoped one-time permit token (second issuance rejected 409)
    const tokRes = await fetch(`${baseUrl}/api/actions/${action.id}/approve`, {
      method: 'POST',
      headers: { Cookie: marcusCookie },
    });
    assert.equal(tokRes.status, 200);
    const { permit } = await tokRes.json();
    assert.ok(permit.token);
    assert.ok(permit.jti);

    const secondTok = await fetch(`${baseUrl}/api/actions/${action.id}/approve`, {
      method: 'POST',
      headers: { Cookie: marcusCookie },
    });
    assert.equal(secondTok.status, 409);

    // Wrong scope rejected
    const wrongScope = await fetch(`${baseUrl}/api/tokens/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: permit.token,
        expectedActionId: action.id,
        expectedScope: 'wrong:scope',
      }),
    });
    assert.equal(wrongScope.status, 403);

    // Valid atomic consumption succeeds once, replay rejected 409
    const consume1 = await fetch(`${baseUrl}/api/tokens/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: permit.token,
        expectedActionId: action.id,
        expectedScope: permit.scope,
        expectedTargetIntegration: 'github_actions',
        expectedEnvironment: 'production-us-east-1',
      }),
    });
    assert.equal(consume1.status, 200);
    assert.equal((await consume1.json()).consumed, true);

    const consume2 = await fetch(`${baseUrl}/api/tokens/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: permit.token, expectedActionId: action.id }),
    });
    assert.equal(consume2.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
