const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'secret',
  'sessionsecret',
  'token',
  'tokenhash',
  'token_hash',
  'apikey',
  'api_key',
  'detectif_api_key',
  'authorization',
  'cookie',
  'x-goog-api-key',
  'privatekey',
  'private_key',
]);

export function sanitizeForLog(value, depth = 0) {
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizeForLog(v, depth + 1);
    }
  }
  return out;
}

function writeLog(level, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: sanitizeForLog(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg, meta) => writeLog('info', msg, meta),
  warn: (msg, meta) => writeLog('warn', msg, meta),
  error: (msg, meta) => writeLog('error', msg, meta),
};
