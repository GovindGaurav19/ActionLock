/**
 * Server-side DetectifAI API adapter.
 * Reads DETECTIF_API_KEY exclusively from process.env on the backend.
 * Never fabricates success results when DETECTIF_API_KEY is missing or upstream fails.
 */

const BASE_URL = process.env.DETECTIF_API_BASE_URL || 'https://platform.detectif.ai';

export const SPEAKER_ID_REGEX = /^[A-Za-z0-9_.:-]{1,64}$/;

export function buildDetectifAiSpeakerId(userId) {
  const cleaned = String(userId || '')
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 64);
  if (!SPEAKER_ID_REGEX.test(cleaned)) {
    throw new Error('Unable to derive a valid DetectifAI speaker_id (1-64 chars, [A-Za-z0-9_.:-])');
  }
  return cleaned;
}

export function getDetectifAiConfigStatus() {
  return {
    configured: Boolean(process.env.DETECTIF_API_KEY),
    baseUrl: BASE_URL,
    webhookSecretConfigured: Boolean(process.env.DETECTIF_WEBHOOK_SECRET),
  };
}

export function mapDetectifAiHttpError(status, data, retryAfterHeader = null) {
  const errObj = data?.error || {};
  const rawCode = errObj.code || data?.code || '';
  let code = 'DETECTIFAI_API_ERROR';
  if (status === 401) code = 'INVALID_API_KEY';
  else if (status === 402) code = 'NO_API_CREDITS';
  else if (status === 403) code = 'MISSING_PERMISSION';
  else if (status === 404) code = 'UNKNOWN_SPEAKER';
  else if (status === 415) code = 'UNSUPPORTED_AUDIO';
  else if (status === 429) code = 'RATE_LIMITED';
  else if (status === 400 || status === 422) {
    code = String(rawCode).toLowerCase().includes('speech') || String(data?.detail || '').toLowerCase().includes('speech')
      ? 'TOO_LITTLE_SPEECH'
      : rawCode || 'INVALID_RECORDING';
  } else if (status >= 500) {
    code = 'PROVIDER_UNAVAILABLE';
  }

  return {
    ok: false,
    code,
    providerCode: rawCode || null,
    status,
    retryAfterSeconds: retryAfterHeader ? Number(retryAfterHeader) || null : null,
    message: errObj.message || data?.detail || `DetectifAI returned HTTP ${status}`,
  };
}

/**
 * Parses POST /v1/speakers/verify (with detect_deepfake=true) response without assuming optional fields.
 * Keeps Eidos and Aletheia results strictly separate.
 */
export function parseDetectifAiVerifyResponse(data) {
  const eidosResult = data?.result || {};
  const eidosOperationId = data?.operation_id || null;
  const eidosDecision = eidosResult.decision === 'match' || eidosResult.decision === 'no_match' ? eidosResult.decision : null;
  const eidosSimilarity = typeof eidosResult.similarity === 'number' ? eidosResult.similarity : null;
  const durationSeconds = typeof eidosResult.duration_seconds === 'number' ? eidosResult.duration_seconds : null;

  const deepfake = data?.deepfake || eidosResult?.deepfake || null;
  const aletheiaOperationId = deepfake?.operation_id || null;
  const aletheiaVerdict = deepfake?.verdict === 'real' || deepfake?.verdict === 'fake' ? deepfake.verdict : null;
  const aletheiaScore = typeof deepfake?.score === 'number' ? deepfake.score : null;
  const aletheiaError = deepfake?.error || null;

  let completeness = 'COMPLETE';
  if (!eidosDecision) {
    completeness = 'MISSING_EIDOS';
  } else if (!deepfake || aletheiaError || !aletheiaVerdict) {
    completeness = 'PARTIAL';
  }

  return {
    requestId: data?.request_id || null,
    completeness,
    eidos: {
      operationId: eidosOperationId,
      decision: eidosDecision,
      similarity: eidosSimilarity,
      durationSeconds,
    },
    aletheia: {
      operationId: aletheiaOperationId,
      verdict: aletheiaVerdict,
      score: aletheiaScore,
      segments: Array.isArray(deepfake?.segments) ? deepfake.segments : [],
      error: aletheiaError,
    },
    raw: data,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifySpeakerWithDetectifAi({
  audioBuffer,
  mimeType = 'audio/webm',
  speakerId,
  detectDeepfake = true,
  idempotencyKey,
  maxRetries = 1,
}) {
  const apiKey = process.env.DETECTIF_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      code: 'DETECTIFAI_NOT_CONFIGURED',
      message: 'Server environment variable DETECTIF_API_KEY is not set. Live verification fails closed to HOLD.',
    };
  }

  if (!idempotencyKey) {
    throw new Error('Idempotency-Key is required for DetectifAI verification calls');
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt += 1;
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), 'challenge.webm');
    form.append('speaker_id', speakerId);
    form.append('detect_deepfake', String(Boolean(detectDeepfake)));

    try {
      const res = await fetch(`${BASE_URL}/v1/speakers/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, data, parsed: parseDetectifAiVerifyResponse(data) };
      }

      const mapped = mapDetectifAiHttpError(res.status, data, res.headers.get('retry-after'));
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt <= maxRetries) {
        const waitMs = Math.min((mapped.retryAfterSeconds || 1) * 1000, 2000);
        await sleep(waitMs);
        continue;
      }
      return mapped;
    } catch (err) {
      if (attempt <= maxRetries) {
        await sleep(500);
        continue;
      }
      return {
        ok: false,
        code: 'PROVIDER_TIMEOUT_OR_UNREACHABLE',
        message: err instanceof Error ? err.message : 'Network error calling DetectifAI',
      };
    }
  }
}

export async function enrollSpeakerWithDetectifAi({
  audioBuffer,
  mimeType = 'audio/webm',
  fileName = 'enrollment.webm',
  speakerId,
  displayName,
  idempotencyKey,
}) {
  const apiKey = process.env.DETECTIF_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      code: 'DETECTIFAI_NOT_CONFIGURED',
      message: 'DETECTIF_API_KEY is not configured on backend server.',
    };
  }
  if (!SPEAKER_ID_REGEX.test(speakerId)) {
    return {
      ok: false,
      code: 'INVALID_SPEAKER_ID',
      message: 'speaker_id must be 1–64 characters matching [A-Za-z0-9_.:-]',
    };
  }

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType }), fileName);
  form.append('speaker_id', speakerId);
  if (displayName) {
    form.append('display_name', String(displayName).slice(0, 100));
  }

  const headers = { Authorization: `Bearer ${apiKey}` };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  try {
    const res = await fetch(`${BASE_URL}/v1/speakers/enroll`, { method: 'POST', headers, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return mapDetectifAiHttpError(res.status, data, res.headers.get('retry-after'));
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      code: 'DETECTIFAI_UNREACHABLE',
      message: err instanceof Error ? err.message : 'Network error calling DetectifAI',
    };
  }
}

export async function listDetectifAiSpeakers() {
  const apiKey = process.env.DETECTIF_API_KEY;
  if (!apiKey) {
    return { ok: false, code: 'DETECTIFAI_NOT_CONFIGURED', message: 'DETECTIF_API_KEY is not configured.' };
  }
  try {
    const res = await fetch(`${BASE_URL}/v1/speakers`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return mapDetectifAiHttpError(res.status, data);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, code: 'DETECTIFAI_UNREACHABLE', message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function deleteDetectifAiSpeaker(speakerId) {
  const apiKey = process.env.DETECTIF_API_KEY;
  if (!apiKey) {
    return { ok: false, code: 'DETECTIFAI_NOT_CONFIGURED', message: 'DETECTIF_API_KEY is not configured.' };
  }
  try {
    const res = await fetch(`${BASE_URL}/v1/speakers/${encodeURIComponent(speakerId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 404) {
      return mapDetectifAiHttpError(res.status, data);
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, code: 'DETECTIFAI_UNREACHABLE', message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchDetectifAiOperation(operationId) {
  const apiKey = process.env.DETECTIF_API_KEY;
  if (!apiKey) {
    return { ok: false, code: 'DETECTIFAI_NOT_CONFIGURED', message: 'DETECTIF_API_KEY is not configured.' };
  }
  try {
    const res = await fetch(`${BASE_URL}/v1/operations/${encodeURIComponent(operationId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return mapDetectifAiHttpError(res.status, data);
    return {
      ok: true,
      data,
      status: data.status,
      type: data.type,
      result: data.result || null,
      error: data.error || null,
    };
  } catch (err) {
    return { ok: false, code: 'DETECTIFAI_UNREACHABLE', message: err instanceof Error ? err.message : 'Network error' };
  }
}
