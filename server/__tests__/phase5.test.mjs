import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { parseDetectifAiVerifyResponse } from '../detectifai.mjs';
import { processPendingWebhooks } from '../services/webhookService.mjs';
import { ACTION_STATES, transitionActionState } from '../services/stateMachine.mjs';

function signWebhook({ secret, msgId, tsSec, bodyStr, format = 'v1,' }) {
  const key = Buffer.from(secret.split('whsec_')[1], 'base64');
  const signed = Buffer.concat([Buffer.from(`${msgId}.${tsSec}.`, 'utf8'), Buffer.from(bodyStr, 'utf8')]);
  const sig = crypto.createHmac('sha256', key).update(signed).digest('base64');
  return `${format}${sig}`;
}

function makeTestConfig(webhookSecret) {
  return {
    port: 0,
    nodeEnv: 'test',
    isProd: false,
    sqliteDbPath: ':memory:',
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    sessionCookieName: 'actionlock_sid',
    sessionTtlSeconds: 3600,
    actionTokenSecret: crypto.randomBytes(32).toString('hex'),
    detectifAi: { apiKey: '', baseUrl: 'https://platform.detectif.ai', webhookSecret },
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

test('Phase 5: DetectifAI webhook signature, deduplication, out-of-order reconciliation & monotonic protection', async () => {
  const whSecret = `whsec_${crypto.randomBytes(32).toString('base64')}`;
  const config = makeTestConfig(whSecret);
  const db = openDatabase(':memory:');
  seedDatabase(db);

  let lastPhrase = '';
  const server = createApp({
    db,
    config,
    speakerProvider: {
      enroll: async ({ speakerId }) => ({ ok: true, data: { operation_id: 'op_enr_wh1', speaker_id: speakerId } }),
    },
    sttProvider: async () => ({ ok: true, transcript: lastPhrase }),
    verifyProvider: async () => {
      // Simulate initial partial synchronous response (Aletheia pending asynchronously)
      const raw = {
        operation_id: 'op_eidos_wh1',
        result: { decision: 'match', similarity: 0.93, duration_seconds: 12.0 },
        deepfake: { operation_id: 'op_aletheia_wh1', error: { code: 'PROCESSING' } },
      };
      return { ok: true, data: raw, parsed: parseDetectifAiVerifyResponse(raw) };
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sampleAudio = Buffer.alloc(4096, 3).toString('base64');

  try {
    const alexCookie = await loginAs(baseUrl, 'alex.chen@acme.corp');
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');

    // Enroll + create action + run challenge recording (leaves action in HOLD due to partial Aletheia)
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
            commitSha: '11aa22bb',
            workflowRunId: '5001',
            targetEnvironment: 'production',
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

    const rec = await (
      await fetch(`${baseUrl}/api/actions/${action.id}/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
        body: JSON.stringify({ challengeId: challenge.id, audioBase64: sampleAudio, mimeType: 'audio/webm' }),
      })
    ).json();
    assert.equal(rec.state, 'HOLD');

    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Invalid signature rejected with 401
    const badRes = await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_bad',
        'webhook-timestamp': String(nowSec),
        'webhook-signature': 'v1,invalid',
      },
      body: JSON.stringify({ type: 'webhook.test' }),
    });
    assert.equal(badRes.status, 401);

    // 2. Valid Standard Webhooks "v1,<sig>" webhook.test accepted & queued
    const testBody = JSON.stringify({ type: 'webhook.test', timestamp: new Date().toISOString() });
    const testSig = signWebhook({ secret: whSecret, msgId: 'msg_test_1', tsSec: nowSec, bodyStr: testBody, format: 'v1,' });
    const testRes = await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_test_1',
        'webhook-timestamp': String(nowSec),
        'webhook-signature': testSig,
      },
      body: testBody,
    });
    assert.equal(testRes.status, 200);
    const testJson = await testRes.json();
    assert.equal(testJson.accepted, true);
    assert.equal(testJson.deduplicated, false);

    // 3. Duplicate webhook-id deduplicated
    const dupRes = await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_test_1',
        'webhook-timestamp': String(nowSec),
        'webhook-signature': testSig,
      },
      body: testBody,
    });
    assert.equal((await dupRes.json()).deduplicated, true);

    // 4. Async deepfake.completed correlated via operation_id (NO action_id in payload!) -> reconciles to VOICE_VERIFIED
    const dfBody = JSON.stringify({
      type: 'deepfake.completed',
      operation_id: 'op_aletheia_wh1',
      result: { verdict: 'real', score: 0.02 },
    });
    const dfSig = signWebhook({ secret: whSecret, msgId: 'msg_df_1', tsSec: nowSec, bodyStr: dfBody, format: 'v1,' });
    const dfRes = await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_df_1',
        'webhook-timestamp': String(nowSec),
        'webhook-signature': dfSig,
      },
      body: dfBody,
    });
    assert.equal(dfRes.status, 200);

    // Allow background queue / explicit drain
    await new Promise((r) => setTimeout(r, 30));
    processPendingWebhooks(db);

    const summary = await (
      await fetch(`${baseUrl}/api/actions/${action.id}/verification`, { headers: { Cookie: sarahCookie } })
    ).json();
    assert.equal(summary.state, 'VOICE_VERIFIED');
    assert.equal(summary.aletheia.verdict, 'real');

    // Only one voice_verifications record created
    const vCount = db.prepare('SELECT COUNT(*) AS c FROM voice_verifications WHERE action_request_id = ?').get(action.id).c;
    assert.equal(vCount, 1);

    // 5. Monotonic protection: advance to WAITING_FOR_PASSKEY, then send late fake deepfake.completed duplicate -> does NOT regress
    transitionActionState({ db, actionRequestId: action.id, toState: ACTION_STATES.WAITING_FOR_PASSKEY });
    const lateBody = JSON.stringify({
      type: 'deepfake.completed',
      operation_id: 'op_aletheia_wh1',
      result: { verdict: 'fake', score: 0.99 },
    });
    const lateSig = signWebhook({ secret: whSecret, msgId: 'msg_df_late', tsSec: nowSec, bodyStr: lateBody, format: 'v1=' });
    await fetch(`${baseUrl}/api/webhooks/detectifai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_df_late',
        'webhook-timestamp': String(nowSec),
        'webhook-signature': lateSig,
      },
      body: lateBody,
    });
    await new Promise((r) => setTimeout(r, 30));
    processPendingWebhooks(db);

    const afterLate = db.prepare('SELECT current_state FROM action_requests WHERE id = ?').get(action.id);
    assert.equal(afterLate.current_state, 'WAITING_FOR_PASSKEY');

    // 6. Webhook events API lists persisted deliveries
    const listWh = await (await fetch(`${baseUrl}/api/webhooks/events`, { headers: { Cookie: sarahCookie } })).json();
    assert.ok(listWh.events.length >= 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
