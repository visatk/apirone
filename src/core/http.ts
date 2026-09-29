import { ApironeError, redactUrl } from './errors.js';
import { MemoryTokenStore, TokenManager, type TokenStore } from './tokens.js';
import type { AuthTokens, CallOptions } from './types.js';
import { buildQuery, sleep } from './util.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A static key, a per-id map, or a resolver (e.g. reading Worker `env` secrets). */
export type TransferKeySource =
  | string
  | Record<string, string>
  | ((id: string) => string | undefined | Promise<string | undefined>);

export interface ClientOptions {
  /** Default: https://apirone.com */
  baseUrl?: string;
  /**
   * Default transfer key(s) for protected endpoints. Can be overridden per call with
   * `{ transferKey }` / `{ accessToken }`.
   */
  transferKey?: TransferKeySource;
  /**
   * `transfer-key` (default): key goes in the body (POST/PATCH) or query (GET) as documented.
   * `jwt`: the client exchanges the key for a short-lived JWT once and sends it as a Bearer header,
   * keeping the key out of URLs at the cost of an extra request per ~10 minutes.
   */
  authMode?: 'transfer-key' | 'jwt';
  /** JWT cache for `authMode: 'jwt'`. Default: in-memory. */
  tokenStore?: TokenStore;
  /** Custom fetch (tests, service bindings, `cf` options). Called without `this`, safe in workerd. */
  fetch?: FetchLike;
  /** Per-attempt timeout. Default 15000. Set 0 to disable. */
  timeoutMs?: number;
  /** Retries for GET/OPTIONS on network errors, 429 and 503. Default 2. Writes are never retried. */
  maxRetries?: number;
  /** Extra headers added to every request. */
  headers?: Record<string, string>;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS';
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  /** Account or wallet id used to authenticate a protected endpoint. */
  authId?: string;
  call?: CallOptions | undefined;
  /** Appended verbatim after the encoded query (Simple Forwarding needs `callback` last, unencoded). */
  rawQueryTail?: string;
  headers?: Record<string, string>;
}

const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const RETRYABLE_STATUS = new Set([429, 503]);

function jsonReplacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly authMode: 'transfer-key' | 'jwt';
  private readonly keySource: TransferKeySource | undefined;
  private readonly baseHeaders: Record<string, string>;
  readonly tokens: TokenManager;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://apirone.com').replace(/\/+$/, '');
    // Never store `fetch` as a bare property and call it as a method: workerd throws "Illegal invocation".
    const userFetch = opts.fetch;
    this.fetchImpl = userFetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.authMode = opts.authMode ?? 'transfer-key';
    this.keySource = opts.transferKey;
    this.baseHeaders = { accept: 'application/json', ...(opts.headers ?? {}) };
    this.tokens = new TokenManager(opts.tokenStore ?? new MemoryTokenStore(), {
      login: (login, password) =>
        this.request<AuthTokens>({ method: 'POST', path: '/api/v2/auth/login', body: { login, password } }),
      refresh: (refreshToken) =>
        this.request<AuthTokens>({
          method: 'POST',
          path: '/api/v2/auth/refresh-token',
          headers: { authorization: `Bearer ${refreshToken}` },
        }),
    });
  }

  private async resolveKey(id: string, call?: CallOptions): Promise<string | undefined> {
    if (call?.transferKey) return call.transferKey;
    const s = this.keySource;
    if (!s) return undefined;
    if (typeof s === 'string') return s;
    if (typeof s === 'function') return s(id);
    return s[id];
  }

  async request<T>(req: HttpRequest): Promise<T> {
    // A stale cached JWT is retried exactly once with a fresh login.
    try {
      return await this.send<T>(req, false);
    } catch (e) {
      if (
        e instanceof ApironeError && e.status === 401 && this.authMode === 'jwt' &&
        req.authId && !req.call?.accessToken && !req.call?.transferKey
      ) {
        await this.tokens.invalidate(req.authId);
        return this.send<T>(req, true);
      }
      throw e;
    }
  }

  private async send<T>(req: HttpRequest, _isReplay: boolean): Promise<T> {
    const headers = new Headers({ ...this.baseHeaders, ...(req.headers ?? {}) });
    const query: Record<string, unknown> = { ...(req.query ?? {}) };
    let body = req.body;

    if (req.authId) {
      if (req.call?.accessToken) {
        headers.set('authorization', `Bearer ${req.call.accessToken}`);
      } else {
        const key = await this.resolveKey(req.authId, req.call);
        if (key) {
          if (this.authMode === 'jwt' && !req.call?.transferKey) {
            const token = await this.tokens.getAccessToken(req.authId, key);
            headers.set('authorization', `Bearer ${token}`);
          } else if (BODY_METHODS.has(req.method)) {
            body = { ...((body as object | undefined) ?? {}), 'transfer-key': key };
          } else {
            query['transfer-key'] = key;
          }
        }
      }
    }

    let url = this.baseUrl + req.path;
    const qs = buildQuery(query);
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    if (req.rawQueryTail) url += (url.includes('?') ? '&' : '?') + req.rawQueryTail;

    const init: RequestInit = { method: req.method, headers };
    if (body !== undefined && BODY_METHODS.has(req.method)) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(body, jsonReplacer);
    }

    const canRetry = req.method === 'GET' || req.method === 'OPTIONS';
    const safeUrl = redactUrl(url);

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchOnce(url, init, req.call?.signal);
      } catch (cause) {
        const aborted = req.call?.signal?.aborted === true;
        const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
        if (canRetry && !aborted && attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ApironeError({
          message: `${req.method} ${safeUrl} failed: ${timedOut ? `timed out after ${this.timeoutMs}ms` : String(cause)}`,
          status: 0,
          method: req.method,
          url: safeUrl,
          code: aborted ? 'aborted' : timedOut ? 'timeout' : 'network',
          cause,
        });
      }

      if (res.ok) return (await parseBody(res)) as T;

      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
        await res.body?.cancel();
        await sleep(retryAfter !== undefined ? Math.min(retryAfter * 1000, 10_000) : backoff(attempt));
        continue;
      }
      const errBody = await parseBody(res);
      throw new ApironeError({
        message: `${req.method} ${safeUrl} -> ${res.status}${describe(errBody)}`,
        status: res.status,
        method: req.method,
        url: safeUrl,
        body: errBody,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
      });
    }
  }

  private async fetchOnce(url: string, init: RequestInit, userSignal?: AbortSignal): Promise<Response> {
    if (!this.timeoutMs && !userSignal) return this.fetchImpl(url, init);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(userSignal?.reason);
    if (userSignal) {
      if (userSignal.aborted) ctrl.abort(userSignal.reason);
      else userSignal.addEventListener('abort', onAbort, { once: true });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (this.timeoutMs) {
      timer = setTimeout(() => {
        const err = new Error('The operation timed out');
        err.name = 'TimeoutError';
        ctrl.abort(err);
      }, this.timeoutMs);
    }
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      // Surface our timeout reason rather than a generic AbortError.
      if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error && ctrl.signal.reason.name === 'TimeoutError') {
        throw ctrl.signal.reason;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      userSignal?.removeEventListener('abort', onAbort);
    }
  }
}

function backoff(attempt: number): number {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 100);
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describe(body: unknown): string {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const m = o.message ?? o.error ?? o.detail;
    if (typeof m === 'string') return `: ${m}`;
  } else if (typeof body === 'string' && body.length < 200) {
    return `: ${body}`;
  }
  return '';
}
