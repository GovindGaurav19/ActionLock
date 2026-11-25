import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { buildDetectifAiSpeakerId, SPEAKER_ID_REGEX } from '../detectifai.mjs';

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

test('Phase 3: speaker_id derivation matches DetectifAI character & length rules', () => {
  const id = buildDetectifAiSpeakerId('spk_usr_sarah_jenkins@acme.corp');
  assert.ok(SPEAKER_ID_REGEX.test(id));
  assert.ok(id.length >= 1 && id.length <= 64);
});

test('Phase 3: informed consent, validation, DetectifAI enrollment persistence, max 5 samples, and deletion', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);

  const calls = { enrolled: [], deleted: [] };
  const mockProvider = {
    enroll: async (args) => {
      calls.enrolled.push(args);
      return {
        ok: true,
        data: { operation_id: `op_enroll_${calls.enrolled.length}`, speaker_id: args.speakerId },
      };
    },
    remove: async (speakerId) => {
      calls.deleted.push(speakerId);
      return { ok: true, data: { deleted: true } };
    },
  };

  const server = createApp({ db, config, speakerProvider: mockProvider });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const adminCookie = await loginAs(baseUrl, 'marcus.vance@acme.corp');
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');
    const sampleAudio = Buffer.alloc(4096, 1).toString('base64');

    // 1. Missing consent rejected — never creates speaker profile
    const noConsent = await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 20,
        consentAccepted: true,
        retentionAcknowledged: false,
      }),
    });
    assert.equal(noConsent.status, 400);
    assert.equal(calls.enrolled.length, 0);

    // 2. Duration out of 15-60s rejected
    const badDuration = await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 8,
        consentAccepted: true,
        retentionAcknowledged: true,
      }),
    });
    assert.equal(badDuration.status, 400);
    assert.equal(calls.enrolled.length, 0);

    // 3. Valid enrollment succeeds and persists consent + profile + operation
    const okRes = await fetch(`${baseUrl}/api/speakers/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 22,
        consentAccepted: true,
        retentionAcknowledged: true,
      }),
    });
    assert.equal(okRes.status, 201);
    const { speaker } = await okRes.json();
    assert.equal(speaker.speakerId, 'spk_usr_sarah_jenkins');
    assert.equal(speaker.enrollmentCount, 1);
    assert.equal(speaker.status, 'ENROLLED');
    assert.equal(speaker.lastOperationId, 'op_enroll_1');
    assert.equal(speaker.retentionAcknowledged, true);

    // 4. List speakers returns persisted enrollment
    const listRes = await fetch(`${baseUrl}/api/speakers`, { headers: { Cookie: sarahCookie } });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.speakers.length, 1);

    // 5. Enforce max 5 samples per speaker
    for (let i = 2; i <= 5; i++) {
      const r = await fetch(`${baseUrl}/api/speakers/enroll`, {
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
      assert.equal(r.status, 201);
    }
    const sixthRes = await fetch(`${baseUrl}/api/speakers/enroll`, {
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
    assert.equal(sixthRes.status, 409);

    // 6. Non-admin cannot delete (RBAC speaker:delete); admin can delete
    const deniedDel = await fetch(`${baseUrl}/api/speakers/spk_usr_sarah_jenkins`, {
      method: 'DELETE',
      headers: { Cookie: sarahCookie },
    });
    assert.equal(deniedDel.status, 403);

    const delRes = await fetch(`${baseUrl}/api/speakers/spk_usr_sarah_jenkins`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    assert.equal(delRes.status, 200);
    assert.deepEqual(calls.deleted, ['spk_usr_sarah_jenkins']);

    const afterDel = db.prepare("SELECT status, deleted_at FROM speaker_profiles WHERE detectifai_speaker_id = 'spk_usr_sarah_jenkins'").get();
    assert.equal(afterDel.status, 'DELETED');
    assert.ok(afterDel.deleted_at);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 3: fail-closed when DETECTIF_API_KEY is unconfigured (never creates fake speaker)', async () => {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);
  const server = createApp({ db, config });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');
    const sampleAudio = Buffer.alloc(4096, 1).toString('base64');
    const res = await fetch(`${baseUrl}/api/speakers/enroll`, {
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
    assert.equal(res.status, 503);
    const count = db.prepare('SELECT COUNT(*) AS c FROM speaker_profiles').get().c;
    assert.equal(count, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
