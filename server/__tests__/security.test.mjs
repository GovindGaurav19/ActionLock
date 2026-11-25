import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeEnvelopeHash, verifyDetectifAiWebhookSignature } from '../crypto.mjs';

test('computeEnvelopeHash detects beneficiary or amount mutation', () => {
  const base = { vendor: 'Meridian Cloud', amount: '$420,000.00', beneficiary: 'ABA:021000021' };
  const mutated = { vendor: 'Meridian Offshore', amount: '$420,000.00', beneficiary: 'CY2900200128' };
  assert.notEqual(computeEnvelopeHash(base), computeEnvelopeHash(mutated));
});

test('verifyDetectifAiWebhookSignature verifies valid HMAC-SHA256 and rejects tampered/stale payloads', () => {
  const rawKey = crypto.randomBytes(32);
  const secret = `whsec_${rawKey.toString('base64')}`;
  const msgId = 'msg_test_123';
  const nowSec = 1700000000;
  const rawBody = Buffer.from('{"event":"speaker.verified"}', 'utf8');
  const signed = Buffer.concat([Buffer.from(`${msgId}.${nowSec}.`, 'utf8'), rawBody]);
  const sig = crypto.createHmac('sha256', rawKey).update(signed).digest('base64');

  const ok = verifyDetectifAiWebhookSignature({
    secret,
    headers: {
      'webhook-id': msgId,
      'webhook-timestamp': String(nowSec),
      'webhook-signature': `v1=${sig}`,
    },
    rawBody,
    nowSec,
  });
  assert.equal(ok.valid, true);

  const stale = verifyDetectifAiWebhookSignature({
    secret,
    headers: {
      'webhook-id': msgId,
      'webhook-timestamp': String(nowSec - 301),
      'webhook-signature': `v1=${sig}`,
    },
    rawBody,
    nowSec,
  });
  assert.equal(stale.valid, false);
  assert.equal(stale.reason, 'timestamp_outside_300s_window');

  const tampered = verifyDetectifAiWebhookSignature({
    secret,
    headers: {
      'webhook-id': msgId,
      'webhook-timestamp': String(nowSec),
      'webhook-signature': `v1=${sig}`,
    },
    rawBody: Buffer.from('{"event":"tampered"}', 'utf8'),
    nowSec,
  });
  assert.equal(tampered.valid, false);
});
