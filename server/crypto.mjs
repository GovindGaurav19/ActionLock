import crypto from 'node:crypto';

export function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
}

export function computeEnvelopeHash(envelopePayload) {
  const canonical = canonicalizeJson(envelopePayload);
  return 'sha256:' + crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Verifies DetectifAI Standard Webhooks HMAC-SHA256 signatures over raw body bytes.
 * SignedPayload = "{webhook-id}.{webhook-timestamp}.{rawBody}"
 * Supports both "v1,<sig>" (Standard Webhooks) and "v1=<sig>" space-delimited formats.
 */
export function verifyDetectifAiWebhookSignature({ secret, headers, rawBody, nowSec = Math.floor(Date.now() / 1000) }) {
  const msgId = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];

  if (!secret || !msgId || !ts || !sigHeader) {
    return { valid: false, reason: 'missing_headers_or_secret' };
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) {
    return { valid: false, reason: 'timestamp_outside_300s_window' };
  }

  const parts = String(secret).split('whsec_');
  if (parts.length !== 2 || !parts[1]) {
    return { valid: false, reason: 'invalid_whsec_format' };
  }

  const secretBytes = Buffer.from(parts[1], 'base64');
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const signedPrefix = Buffer.from(`${msgId}.${ts}.`, 'utf8');
  const signedContent = Buffer.concat([signedPrefix, bodyBuffer]);
  const computedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  const candidates = [];
  for (const tok of String(sigHeader).trim().split(/\s+/)) {
    if (tok.startsWith('v1,') || tok.startsWith('v1=')) {
      candidates.push(tok.slice(3));
    }
  }

  const computedBuf = Buffer.from(computedSig, 'utf8');
  for (const candidate of candidates) {
    const candBuf = Buffer.from(candidate, 'utf8');
    if (candBuf.length === computedBuf.length && crypto.timingSafeEqual(computedBuf, candBuf)) {
      return { valid: true, reason: 'verified' };
    }
  }
  return { valid: false, reason: 'signature_mismatch' };
}

/**
 * Verifies GitHub webhook X-Hub-Signature-256 ("sha256=<hex>") over exact raw body bytes.
 */
export function verifyGitHubWebhookSignature({ secret, signatureHeader, rawBody }) {
  const sig = String(signatureHeader || '').trim();
  if (!secret) {
    return { valid: false, reason: 'github_webhook_secret_not_configured' };
  }
  if (!sig || !sig.startsWith('sha256=')) {
    return { valid: false, reason: 'missing_or_malformed_signature_header' };
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex')}`;

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  return { valid: true, reason: 'verified' };
}

/**
 * Creates a short-lived RS256 GitHub App JWT (max 10 min lifetime per GitHub docs).
 */
export function createGitHubAppJwt({ appId, privateKeyPem, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!appId || !privateKeyPem) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to sign GitHub App JWT');
  }
  const normalizedKey = String(privateKeyPem).replace(/\\n/g, '\n');
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({
      iat: nowSec - 60,
      exp: nowSec + 540,
      iss: String(appId),
    }),
  ).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto.createSign('RSA-SHA256').update(signingInput).sign(normalizedKey).toString('base64url');
  return `${signingInput}.${sigB64}`;
}
