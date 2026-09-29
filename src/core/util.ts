import type { Amount, Destination } from './types.js';

/** Serialize a query value; arrays become comma lists, bigint becomes a decimal string. */
function qv(v: unknown): string {
  if (Array.isArray(v)) return v.map(qv).join(',');
  return String(typeof v === 'bigint' ? v.toString() : v);
}

export function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(qv(v))}`);
  }
  return parts.join('&');
}

/** Apirone `q` filter: `key:value,key:value`. */
export function buildFilter(
  filter: Record<string, string | number | boolean | undefined> | undefined,
): string | undefined {
  if (!filter) return undefined;
  const parts = Object.entries(filter)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`);
  return parts.length ? parts.join(',') : undefined;
}

/** Query-string form of destinations: `addr:amount,addr:amount` (amount may be `50%`). */
export function formatDestinations(d: string | Destination[]): string {
  if (typeof d === 'string') return d;
  return d.map((x) => (x.amount === undefined ? x.address : `${x.address}:${amt(x.amount)}`)).join(',');
}

function amt(a: Amount): string {
  return typeof a === 'bigint' ? a.toString() : String(a);
}

/** Convert an API/callback amount to bigint without float rounding for strings. */
export function toBigInt(v: number | string | bigint): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') return BigInt(v);
  if (!Number.isSafeInteger(v)) {
    throw new RangeError(
      'Amount is not a safe integer; if the API returned it as a JSON number, precision may already be lost. Prefer string amounts.',
    );
  }
  return BigInt(v);
}

export const seg = encodeURIComponent;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Returns the `exp` claim in ms since epoch, or undefined if the token can't be decoded. */
export function jwtExpiryMs(token: string): number | undefined {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1] ?? '')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Constant-time string comparison using only portable JS (no node:crypto). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
