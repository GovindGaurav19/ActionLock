import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { parseDetectifAiVerifyResponse } from '../detectifai.mjs';

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

test('Phase 4: parseDetectifAiVerifyResponse preserves Eidos & Aletheia separately and flags partial results', () => {
  const complete = parseDetectifAiVerifyResponse({
    request_id: 'req_1',
    operation_id: 'op_eidos_1',
    result: { decision: 'match', similarity: 0.91, duration_seconds: 12.4 },
    deepfake: { operation_id: 'op_aletheia_1', verdict: 'real', score: 0.04 },
  });
  assert.equal(complete.completeness, 'COMPLETE');
  assert.equal(complete.eidos.decision, 'match');
  assert.equal(complete.eidos.similarity, 0.91);
  assert.equal(complete.aletheia.verdict, 'real');

  const partial = parseDetectifAiVerifyResponse({
    operation_id: 'op_eidos_2',
    result: { decision: 'match', similarity: 0.89 },
    deepfake: { error: { code: 'INSUFFICIENT_AUDIO', message: 'too short' } },
  });
  assert.equal(partial.completeness, 'PARTIAL');
});

test('Phase 4: single-recording challenge, STT, combined DetectifAI outcomes, replay, partial & recovery', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  let sttMode = 'match';
  let verifyMode = 'dual_pass';
  let lastChallengePhrase = '';
  const verifyCalls = [];

  const server = createApp({
    db,
    config,
    speakerProvider: {
      enroll: async ({ speakerId }) => ({ ok: true, data: { operation_id: 'op_enr_1', speaker_id: speakerId } }),
    },
    sttProvider: async () => {
      if (sttMode === 'unavailable') return { ok: false, code: 'STT_NOT_CONFIGURED', message: 'No STT' };
      if (sttMode === 'mismatch') return { ok: true, transcript: 'completely wrong phrase without nonce' };
      return { ok: true, transcript: lastChallengePhrase };
    },
    verifyProvider: async (args) => {
      verifyCalls.push(args);
      if (verifyMode === 'credits') {
        return { ok: false, code: 'NO_API_CREDITS', status: 402, message: 'Out of credits' };
      }
      if (verifyMode === 'fake_match') {
        const raw = {
          operation_id: 'op_eidos_fake',
          result: { decision: 'match', similarity: 0.92, duration_seconds: 12.0 },
          deepfake: { operation_id: 'op_aletheia_fake', verdict: 'fake', score: 0.95 },
        };
        return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
      }
      if (verifyMode === 'no_match') {
        const raw = {
          operation_id: 'op_eidos_nomatch',
          result: { decision: 'no_match', similarity: 0.29, duration_seconds: 11.2 },
          deepfake: { operation_id: 'op_aletheia_real', verdict: 'real', score: 0.03 },
        };
        return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
      }
      if (verifyMode === 'partial') {
        const raw = {
          operation_id: 'op_eidos_partial',
          result: { decision: 'match', similarity: 0.88, duration_seconds: 5.0 },
          deepfake: { operation_id: 'op_aletheia_err', error: { code: 'TOO_LITTLE_SPEECH' } },
        };
        return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
      }
      const raw = {
        operation_id: 'op_eidos_ok',
        result: { decision: 'match', similarity: 0.94, duration_seconds: 13.5 },
        deepfake: { operation_id: 'op_aletheia_ok', verdict: 'real', score: 0.02 },
      };
      return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
    },
    fetchOperationProvider: async (operationId) => ({
      ok: true,
      status: 'succeeded',
      type: 'deepfake.detect',
      result: { verdict: 'real', score: 0.03 },
      data: { operation_id: operationId, status: 'succeeded', type: 'deepfake.detect', result: { verdict: 'real', score: 0.03 } },
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sampleAudio = Buffer.alloc(4096, 2).toString('base64');

  try {
    const alexCookie = await loginAs(baseUrl, 'alex.chen@acme.corp');
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');

    // Enroll Sarah Jenkins first
    const enr = await fetch(`${baseUrl}/api/speakers/enroll`, {
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
    assert.equal(enr.status, 201);

    // Create GitHub action request (Alex -> Sarah)
    const actRes = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        category: 'GITHUB_DEPLOYMENT',
        claimedApproverEmail: 'sarah.jenkins@acme.corp',
        parameters: {
          repositoryOwner: 'acme-corp',
          repositoryName: 'core-auth-gateway',
          commitSha: 'f89bc10',
          workflowRunId: '4819',
          targetEnvironment: 'production-us-east-1',
        },
      }),
    });
    const { action } = await actRes.json();

    // 1. Genuine pass: STT + Eidos match + Aletheia real -> VOICE_VERIFIED (NOT APPROVED)
    const ch1 = await (
      await fetch(`${baseUrl}/api/actions/${action.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({}),
      })
    ).json();
    lastChallengePhrase = ch1.challenge.phrase;

    const rec1 = await fetch(`${baseUrl}/api/actions/${action.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ challengeId: ch1.challenge.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
    });
    assert.equal(rec1.status, 200);
    const body1 = await rec1.json();
    assert.equal(body1.state, 'VOICE_VERIFIED');
    assert.equal(body1.eidos.decision, 'match');
    assert.equal(body1.aletheia.verdict, 'real');
    assert.equal(verifyCalls.at(-1).detectDeepfake, true);

    // 2. Replay same consumed challenge -> 409
    const replay = await fetch(`${baseUrl}/api/actions/${action.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ challengeId: ch1.challenge.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
    });
    assert.equal(replay.status, 409);

    // Create fresh action for failure scenarios
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
              repositoryName: 'core-auth-gateway',
              commitSha: 'aa11bb22',
              workflowRunId: '4820',
              targetEnvironment: 'production-us-east-1',
            },
          }),
        })
      ).json()
    ).action;

    // 3. STT phrase mismatch -> HOLD, DetectifAI not even invoked
    const ch2 = (
      await (
        await fetch(`${baseUrl}/api/actions/${act2.id}/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
          body: JSON.stringify({}),
        })
      ).json()
    ).challenge;
    lastChallengePhrase = ch2.phrase;
    sttMode = 'mismatch';
    const prevCalls = verifyCalls.length;
    const mismatchRes = await (
      await fetch(`${baseUrl}/api/actions/${act2.id}/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({ challengeId: ch2.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
      })
    ).json();
    assert.equal(mismatchRes.state, 'HOLD');
    assert.equal(verifyCalls.length, prevCalls);

    // 4. Synthetic clone (Aletheia fake even though Eidos matches) -> HOLD + Incident
    sttMode = 'match';
    verifyMode = 'fake_match';
    const ch3 = (
      await (
        await fetch(`${baseUrl}/api/actions/${act2.id}/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
          body: JSON.stringify({}),
        })
      ).json()
    ).challenge;
    lastChallengePhrase = ch3.phrase;
    const fakeRes = await (
      await fetch(`${baseUrl}/api/actions/${act2.id}/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({ challengeId: ch3.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
      })
    ).json();
    assert.equal(fakeRes.state, 'HOLD');
    assert.equal(fakeRes.aletheia.verdict, 'fake');
    const incCount = db.prepare('SELECT COUNT(*) AS c FROM security_incidents WHERE action_request_id = ?').get(act2.id).c;
    assert.equal(incCount, 1);

    // 5. Partial result (deepfake.error) -> HOLD, then recover operation via GET /v1/operations/{id}
    verifyMode = 'partial';
    const ch4 = (
      await (
        await fetch(`${baseUrl}/api/actions/${act2.id}/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
          body: JSON.stringify({}),
        })
      ).json()
    ).challenge;
    lastChallengePhrase = ch4.phrase;
    const partRes = await (
      await fetch(`${baseUrl}/api/actions/${act2.id}/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({ challengeId: ch4.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
      })
    ).json();
    assert.equal(partRes.state, 'HOLD');
    assert.equal(partRes.evidenceStatus, 'PARTIAL');

    const recOp = await fetch(`${baseUrl}/api/operations/op_aletheia_err/recover`, {
      method: 'POST',
      headers: { Cookie: sarahCookie },
    });
    assert.equal(recOp.status, 200);
    const afterRec = await (
      await fetch(`${baseUrl}/api/actions/${act2.id}/verification`, { headers: { Cookie: sarahCookie } })
    ).json();
    assert.equal(afterRec.state, 'VOICE_VERIFIED');
    assert.equal(afterRec.aletheia.verdict, 'real');

    // 6. No API credits on a fresh action -> 503 + HOLD
    const act3 = (
      await (
        await fetch(`${baseUrl}/api/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
          body: JSON.stringify({
            category: 'GITHUB_DEPLOYMENT',
            claimedApproverEmail: 'sarah.jenkins@acme.corp',
            parameters: {
              repositoryOwner: 'acme-corp',
              repositoryName: 'core-auth-gateway',
              commitSha: 'cc33dd44',
              workflowRunId: '4821',
              targetEnvironment: 'production-us-east-1',
            },
          }),
        })
      ).json()
    ).action;

    verifyMode = 'credits';
    const ch5 = (
      await (
        await fetch(`${baseUrl}/api/actions/${act3.id}/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
          body: JSON.stringify({}),
        })
      ).json()
    ).challenge;
    lastChallengePhrase = ch5.phrase;
    const credRes = await fetch(`${baseUrl}/api/actions/${act3.id}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ challengeId: ch5.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
    });
    assert.equal(credRes.status, 503);
    const credBody = await credRes.json();
    assert.equal(credBody.state, 'HOLD');
    assert.equal(credBody.providerError.code, 'NO_API_CREDITS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
