import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDatabase } from '../db/database.mjs';
import { DEMO_PASSWORD_DEFAULT, seedDatabase } from '../db/seed.mjs';
import { createApp } from '../app.mjs';
import { createActionRequest } from '../services/envelopeService.mjs';
import { ACTION_STATES, transitionActionState } from '../services/stateMachine.mjs';

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

async function setupServer() {
  const config = makeTestConfig();
  const db = openDatabase(':memory:');
  seedDatabase(db);
  const server = createApp({ db, config });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, db, baseUrl: `http://127.0.0.1:${port}` };
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

test('Phase 2: GitHub & Finance canonical envelopes, SoD, mutation invalidation, and tamper detection', async () => {
  const { server, db, baseUrl } = await setupServer();
  try {
    const alexCookie = await loginAs(baseUrl, 'alex.chen@acme.corp');
    const sarahCookie = await loginAs(baseUrl, 'sarah.jenkins@acme.corp');
    const danCookie = await loginAs(baseUrl, 'dan.sullivan@acme.corp');

    // 1. Self-approval setup rejected (alex.chen cannot designate alex.chen as approver)
    const selfRes = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        category: 'GITHUB_DEPLOYMENT',
        claimedApproverEmail: 'alex.chen@acme.corp',
        parameters: {
          repositoryOwner: 'acme-corp',
          repositoryName: 'core-auth-gateway',
          commitSha: 'f89bc10',
          workflowRunId: '4819',
          targetEnvironment: 'production-us-east-1',
        },
      }),
    });
    assert.equal(selfRes.status, 403);

    // 2. Create valid GitHub deployment Action Envelope
    const ghCreate = await fetch(`${baseUrl}/api/actions`, {
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
          deploymentParams: { canary: '10%' },
        },
      }),
    });
    assert.equal(ghCreate.status, 201);
    const { action: ghAction } = await ghCreate.json();
    assert.equal(ghAction.state, 'PENDING');
    assert.equal(ghAction.version, 1);
    assert.match(ghAction.actionHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(ghAction.hashIntegrityValid, true);

    // 3. Requester (Alex) cannot reject/arbitrate own action
    const selfReject = await fetch(`${baseUrl}/api/actions/${ghAction.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({ reason: 'self test' }),
    });
    assert.equal(selfReject.status, 403);

    // 4. Advance GitHub action to CHALLENGE_ISSUED, then mutate commitSha -> creates v2 & INVALIDATED
    transitionActionState({
      db,
      actionRequestId: ghAction.id,
      toState: ACTION_STATES.CHALLENGE_ISSUED,
      actorUserId: 'usr_sarah_jenkins',
      reason: 'Challenge issued',
    });

    const mutateGh = await fetch(`${baseUrl}/api/actions/${ghAction.id}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alexCookie },
      body: JSON.stringify({
        parameters: { commitSha: 'deadbeef99' },
        reason: 'New commit pushed',
      }),
    });
    assert.equal(mutateGh.status, 200);
    const mutateJson = await mutateGh.json();
    assert.equal(mutateJson.mutated, true);
    assert.notEqual(mutateJson.previousHash, mutateJson.newHash);
    assert.equal(mutateJson.action.version, 2);
    assert.equal(mutateJson.action.state, 'INVALIDATED');
    assert.equal(mutateJson.action.versions.length, 2);

    // Verify expectedActionHash check rejects old v1 hash
    const staleHashCheck = await fetch(`${baseUrl}/api/actions/${ghAction.id}/verify-hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sarahCookie },
      body: JSON.stringify({ expectedActionHash: ghAction.actionHash }),
    });
    assert.equal(staleHashCheck.status, 409);

    // 5. Create Finance approval envelope & mutate beneficiary/amount
    const finCreate = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: danCookie },
      body: JSON.stringify({
        category: 'FINANCE_APPROVAL',
        claimedApproverEmail: 'elena.rostova@acme.corp',
        environment: 'erp_sandbox',
        parameters: {
          vendorReference: 'Meridian Cloud Infrastructure Ltd',
          beneficiaryReference: 'ABA:021000021:8841',
          amount: 420000,
          currency: 'USD',
          purpose: 'Annual Cloud Infrastructure Settlement',
        },
      }),
    });
    assert.equal(finCreate.status, 201);
    const { action: finAction } = await finCreate.json();

    const mutateFin = await fetch(`${baseUrl}/api/actions/${finAction.id}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: danCookie },
      body: JSON.stringify({
        parameters: { beneficiaryReference: 'CY2900200128000000029102', amount: 425000 },
        reason: 'Beneficiary changed after submission',
      }),
    });
    assert.equal(mutateFin.status, 200);
    const finMutated = await mutateFin.json();
    assert.equal(finMutated.action.state, 'INVALIDATED');
    assert.equal(finMutated.action.version, 2);

    // 6. Audit events persisted & chained
    const auditRes = await fetch(`${baseUrl}/api/audit-events`, { headers: { Cookie: sarahCookie } });
    assert.equal(auditRes.status, 200);
    const auditJson = await auditRes.json();
    assert.ok(auditJson.events.length >= 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 2: state machine enforces valid transitions, tamper detection, and expiry', () => {
  const db = openDatabase(':memory:');
  seedDatabase(db);

  const authCtx = {
    user: { id: 'usr_alex_chen', email: 'alex.chen@acme.corp', roles: ['REQUESTER'] },
    organisation: { id: 'org_acme_enterprise' },
  };
  const created = createActionRequest({
    db,
    authCtx,
    input: {
      category: 'GITHUB_DEPLOYMENT',
      claimedApproverEmail: 'sarah.jenkins@acme.corp',
      parameters: {
        repositoryOwner: 'acme-corp',
        repositoryName: 'core-auth-gateway',
        commitSha: 'abc1234',
        workflowRunId: '101',
        targetEnvironment: 'production',
      },
    },
  });

  // Cannot jump PENDING -> APPROVED or PENDING -> TOKEN_ISSUED
  assert.throws(
    () =>
      transitionActionState({
        db,
        actionRequestId: created.id,
        toState: ACTION_STATES.APPROVED,
        actorUserId: 'usr_sarah_jenkins',
      }),
    /Invalid state transition/,
  );

  // Valid progression: PENDING -> CHALLENGE_ISSUED -> VOICE_CHECK_PENDING -> VOICE_VERIFIED
  transitionActionState({ db, actionRequestId: created.id, toState: ACTION_STATES.CHALLENGE_ISSUED });
  transitionActionState({ db, actionRequestId: created.id, toState: ACTION_STATES.VOICE_CHECK_PENDING });
  transitionActionState({ db, actionRequestId: created.id, toState: ACTION_STATES.VOICE_VERIFIED });

  // VOICE_VERIFIED cannot jump directly to APPROVED or TOKEN_ISSUED
  assert.throws(
    () => transitionActionState({ db, actionRequestId: created.id, toState: ACTION_STATES.APPROVED }),
    /Invalid state transition/,
  );

  // Tamper DB canonical JSON directly -> forward transition fails closed to HOLD
  db.prepare('UPDATE action_envelopes SET canonical_json = ? WHERE action_request_id = ?').run(
    JSON.stringify({ tampered: true }),
    created.id,
  );
  assert.throws(
    () => transitionActionState({ db, actionRequestId: created.id, toState: ACTION_STATES.WAITING_FOR_PASSKEY }),
    /action placed on HOLD/,
  );
  const afterTamper = db.prepare('SELECT current_state FROM action_requests WHERE id = ?').get(created.id);
  assert.equal(afterTamper.current_state, ACTION_STATES.HOLD);

  // Expired action transitions to EXPIRED on attempted progress
  const expired = createActionRequest({
    db,
    authCtx,
    input: {
      category: 'GITHUB_DEPLOYMENT',
      claimedApproverEmail: 'sarah.jenkins@acme.corp',
      parameters: {
        repositoryOwner: 'acme-corp',
        repositoryName: 'core-auth-gateway',
        commitSha: 'def5678',
        workflowRunId: '102',
        targetEnvironment: 'production',
      },
    },
  });
  db.prepare('UPDATE action_requests SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expired.id);
  assert.throws(
    () => transitionActionState({ db, actionRequestId: expired.id, toState: ACTION_STATES.CHALLENGE_ISSUED }),
    /expired/,
  );
  const afterExp = db.prepare('SELECT current_state FROM action_requests WHERE id = ?').get(expired.id);
  assert.equal(afterExp.current_state, ACTION_STATES.EXPIRED);
});
