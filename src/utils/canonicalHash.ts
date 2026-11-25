/**
 * RFC 8785-inspired deterministic JSON canonicalizer + SHA-256 Action Envelope hash.
 * Ensures field ordering is canonical so any payload mutation recomputes a different digest.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatShortSha(hex: string): string {
  if (hex.startsWith('sha256:')) {
    const raw = hex.slice(7);
    return raw.length > 18 ? `sha256:${raw.slice(0, 12)}...${raw.slice(-6)}` : hex;
  }
  return hex.length > 18 ? `sha256:${hex.slice(0, 12)}...${hex.slice(-6)}` : `sha256:${hex}`;
}
