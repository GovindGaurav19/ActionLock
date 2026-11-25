import crypto from 'node:crypto';
import fs from 'node:fs';

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

export function normalizeSpokenText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compares server-transcribed speech against the expected dynamic challenge phrase.
 * Checks normalized token overlap and requires the unpredictable challenge words/nonce tokens.
 */
export function compareChallengePhrase(expectedPhrase, transcript, requiredTokens = []) {
  const normExpected = normalizeSpokenText(expectedPhrase);
  const normTranscript = normalizeSpokenText(transcript);
  if (!normTranscript) {
    return { matched: false, coverage: 0, missingRequired: requiredTokens };
  }

  const expectedWords = normExpected.split(' ').filter(Boolean);
  const transcriptWords = new Set(normTranscript.split(' ').filter(Boolean));

  const matchedWords = expectedWords.filter((w) => transcriptWords.has(w));
  const coverage = expectedWords.length > 0 ? matchedWords.length / expectedWords.length : 0;

  const missingRequired = requiredTokens
    .map((t) => normalizeSpokenText(t))
    .filter((t) => t && !normTranscript.includes(t));

  const matched = coverage >= 0.75 && missingRequired.length === 0;
  return { matched, coverage: Number(coverage.toFixed(3)), missingRequired };
}

async function getGoogleAccessToken(credentialsPath) {
  const raw = fs.readFileSync(credentialsPath, 'utf8');
  const creds = JSON.parse(raw);
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Invalid Google service account credentials file');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(creds.private_key, 'base64url');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || `Google OAuth token failed (${tokenRes.status})`);
  }
  return tokenJson.access_token;
}

/**
 * Server-side Google Cloud Speech-to-Text V2 synchronous recognition.
 * Never accepts or trusts browser-supplied transcripts.
 */
export async function transcribeWithGoogleSttV2({ audioBuffer, config }) {
  const projectId = config?.stt?.projectId;
  const credentialsPath = config?.stt?.credentialsPath;
  const languageCode = config?.stt?.languageCode || 'en-US';
  const model = config?.stt?.model || 'latest_short';

  if (!projectId || !credentialsPath) {
    return {
      ok: false,
      code: 'STT_NOT_CONFIGURED',
      message: 'Google Cloud Speech-to-Text V2 (GOOGLE_CLOUD_PROJECT_ID / GOOGLE_APPLICATION_CREDENTIALS) is not configured.',
    };
  }
  if (!fs.existsSync(credentialsPath)) {
    return {
      ok: false,
      code: 'STT_CREDENTIALS_MISSING',
      message: 'GOOGLE_APPLICATION_CREDENTIALS file path does not exist on server.',
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(credentialsPath);
    const endpoint = `https://speech.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/global/recognizers/_:recognize`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          autoDecodingConfig: {},
          languageCodes: [languageCode],
          model,
        },
        content: audioBuffer.toString('base64'),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        code: 'STT_API_ERROR',
        status: res.status,
        message: data?.error?.message || `Google STT V2 returned HTTP ${res.status}`,
      };
    }

    const transcript = (data.results || [])
      .map((r) => r?.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    if (!transcript) {
      return {
        ok: false,
        code: 'STT_EMPTY_TRANSCRIPT',
        message: 'Speech-to-Text returned no intelligible spoken words.',
      };
    }

    return { ok: true, transcript, model, languageCode };
  } catch (err) {
    return {
      ok: false,
      code: 'STT_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Google STT V2 request failed',
    };
  }
}
