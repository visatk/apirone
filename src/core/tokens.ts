import type { AuthTokens } from './types.js';
import { jwtExpiryMs } from './util.js';

export interface StoredTokens {
  access: string;
  refresh: string;
  /** ms since epoch */
  accessExpMs: number;
  refreshExpMs?: number;
}

/**
 * Where JWTs are cached. The default is per-isolate memory. In Workers, isolates are recycled at
 * will, so use `KVTokenStore` (from the workerd entry) to share tokens across isolates.
 */
export interface TokenStore {
  get(login: string): Promise<StoredTokens | null | undefined>;
  set(login: string, tokens: StoredTokens): Promise<void>;
  delete(login: string): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private readonly map = new Map<string, StoredTokens>();
  async get(login: string) { return this.map.get(login) ?? null; }
  async set(login: string, tokens: StoredTokens) { this.map.set(login, tokens); }
  async delete(login: string) { this.map.delete(login); }
}

export interface AuthTransport {
  login(login: string, password: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
}

const DEFAULT_ACCESS_LIFETIME_MS = 10 * 60 * 1000; // docs: access tokens last 10 minutes by default

function toStored(t: AuthTokens): StoredTokens {
  const accessExpMs = jwtExpiryMs(t['access-token']) ?? Date.now() + DEFAULT_ACCESS_LIFETIME_MS;
  const refreshExpMs = jwtExpiryMs(t['refresh-token']);
  return {
    access: t['access-token'],
    refresh: t['refresh-token'],
    accessExpMs,
    ...(refreshExpMs !== undefined ? { refreshExpMs } : {}),
  };
}

/**
 * Deliberately has no in-flight de-duplication map: a promise created in one request cannot be
 * awaited from another in workerd ("I/O on behalf of a different request"). Worst case two
 * concurrent requests each log in once.
 */
export class TokenManager {
  constructor(
    private readonly store: TokenStore,
    private readonly transport: AuthTransport,
    private readonly skewMs = 30_000,
  ) {}

  async getAccessToken(login: string, password: string): Promise<string> {
    const now = Date.now();
    const cached = await this.store.get(login);
    if (cached && cached.accessExpMs - this.skewMs > now) return cached.access;

    if (cached && (cached.refreshExpMs === undefined || cached.refreshExpMs - this.skewMs > now)) {
      try {
        const fresh = toStored(await this.transport.refresh(cached.refresh));
        await this.store.set(login, fresh);
        return fresh.access;
      } catch {
        // fall through to a full login
      }
    }
    const fresh = toStored(await this.transport.login(login, password));
    await this.store.set(login, fresh);
    return fresh.access;
  }

  async invalidate(login: string): Promise<void> {
    await this.store.delete(login);
  }
}
