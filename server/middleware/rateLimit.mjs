import { RateLimitError } from '../utils/errors.mjs';

export function createRateLimiter({ windowMs = 60_000, maxRequests = 30 } = {}) {
  const buckets = new Map();

  return function checkRateLimit(key) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (buckets.get(key) || []).filter((ts) => ts > cutoff);
    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      throw new RateLimitError(retryAfterSec);
    }
    timestamps.push(now);
    buckets.set(key, timestamps);
  };
}
