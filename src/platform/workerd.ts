import type { FetchLike } from '../core/http.js';
import type { StoredTokens, TokenStore } from '../core/tokens.js';

export const runtime = 'workerd' as const;

/** Structural subset of Cloudflare's `KVNamespace`, so this package needs no `@cloudflare/workers-types` at runtime. */
export interface KVLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Shares JWTs across isolates and colos via Workers KV (`authMode: 'jwt'`). Tokens are credentials:
 * use a dedicated namespace. KV is eventually consistent, so a stale token can occasionally be read;
 * the client transparently re-logs-in once on a 401.
 */
export class KVTokenStore implements TokenStore {
  constructor(private readonly kv: KVLike, private readonly prefix = 'apirone:jwt:') {}

  async get(login: string): Promise<StoredTokens | null> {
    const v = await this.kv.get(this.prefix + login, 'json');
    return (v as StoredTokens | null) ?? null;
  }

  async set(login: string, tokens: StoredTokens): Promise<void> {
    // KV requires expirationTtl >= 60. Keep entries until the refresh token expires (default 24h).
    const ttl = tokens.refreshExpMs
      ? Math.max(60, Math.floor((tokens.refreshExpMs - Date.now()) / 1000))
      : 86_400;
    await this.kv.put(this.prefix + login, JSON.stringify(tokens), { expirationTtl: ttl });
  }

  async delete(login: string): Promise<void> {
    await this.kv.delete(this.prefix + login);
  }
}

/** Anything with a `fetch(request)` method: a service binding, Durable Object stub, or `env.ASSETS`. */
export interface FetcherLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * Route Apirone traffic through a Fetcher, e.g. an outbound-proxy Worker bound as a service, to
 * add logging/allow-listing or to pin an egress path. Pass the result as `ClientOptions.fetch`.
 */
export function fetcherToFetch(fetcher: FetcherLike): FetchLike {
  return (input, init) => fetcher.fetch(input, init);
}
