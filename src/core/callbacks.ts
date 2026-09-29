import type { Currency, Destination, InvoiceStatus, Units } from './types.js';
import { INVOICE_STATUSES } from './types.js';
import { safeEqual } from './util.js';

/**
 * Account / wallet / address callback: sent on every confirmation count from 0 upward, retried
 * each block until you answer `*ok*`. De-duplicate on `input_transaction_hash` + `confirmations`.
 */
export interface TransactionCallback {
  kind: 'transaction';
  value: Units;
  input_address: string;
  confirmations: number;
  input_transaction_hash: string;
  /** Whatever you set in `callback.data` when creating the address/wallet. */
  data?: Record<string, unknown>;
  account?: string;
  wallet?: string;
  currency?: Currency;
  /** Present once funds were forwarded. */
  transaction_hash?: string;
  payment?: string;
  destinations?: Array<Destination & { amount: Units }>;
  raw: Record<string, unknown>;
}

/** Invoice status change. Always POST + JSON. */
export interface InvoiceCallback {
  kind: 'invoice';
  account: string;
  invoice: string;
  status: InvoiceStatus;
  raw: Record<string, unknown>;
}

/** Simple Forwarding v1: always GET, parameters in the query string. */
export interface ForwardingCallback {
  kind: 'forwarding';
  value: Units;
  input_address: string;
  confirmations: number;
  input_transaction_hash: string;
  transaction_hash?: string;
  destination_address?: string;
  value_forwarded?: Units;
  /** Your own query parameters from the callback URL (order_id, secret, ...). */
  raw: Record<string, unknown>;
}

export type ApironeCallback = TransactionCallback | InvoiceCallback | ForwardingCallback;

/** Integers that fit a double become numbers; anything larger stays a string so wei never loses precision. */
function units(v: unknown): Units {
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  return s;
}

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function maybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try { return JSON.parse(t); } catch { return v; }
}

/**
 * Reads an Apirone callback from a Request (query string, JSON body or form body) and classifies it.
 * Does not consume the original request body (it clones first). Throws on an unrecognised payload.
 */
export async function parseCallback(request: Request): Promise<ApironeCallback> {
  const raw: Record<string, unknown> = {};
  const url = new URL(request.url);
  for (const [k, v] of url.searchParams) raw[k] = v;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.clone().text();
    if (text) {
      const ct = request.headers.get('content-type') ?? '';
      if (ct.includes('application/x-www-form-urlencoded')) {
        for (const [k, v] of new URLSearchParams(text)) raw[k] = v;
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw new TypeError('Callback body is not valid JSON'); }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(raw, parsed);
      }
    }
  }

  if (typeof raw.invoice === 'string' && typeof raw.status === 'string') {
    if (!(INVOICE_STATUSES as readonly string[]).includes(raw.status)) {
      throw new TypeError(`Unknown invoice status: ${raw.status}`);
    }
    return {
      kind: 'invoice',
      account: String(raw.account ?? ''),
      invoice: raw.invoice,
      status: raw.status as InvoiceStatus,
      raw,
    };
  }

  if (typeof raw.input_address === 'string' && raw.input_transaction_hash !== undefined) {
    const base = {
      value: units(raw.value),
      input_address: raw.input_address,
      confirmations: int(raw.confirmations),
      input_transaction_hash: String(raw.input_transaction_hash),
      ...(raw.transaction_hash !== undefined ? { transaction_hash: String(raw.transaction_hash) } : {}),
      raw,
    };
    if (raw.destination_address !== undefined || raw.value_forwarded !== undefined) {
      return {
        kind: 'forwarding',
        ...base,
        ...(raw.destination_address !== undefined ? { destination_address: String(raw.destination_address) } : {}),
        ...(raw.value_forwarded !== undefined ? { value_forwarded: units(raw.value_forwarded) } : {}),
      };
    }
    const data = maybeJson(raw.data);
    const destinations = maybeJson(raw.destinations);
    return {
      kind: 'transaction',
      ...base,
      ...(data && typeof data === 'object' ? { data: data as Record<string, unknown> } : {}),
      ...(raw.account !== undefined ? { account: String(raw.account) } : {}),
      ...(raw.wallet !== undefined ? { wallet: String(raw.wallet) } : {}),
      ...(raw.currency !== undefined ? { currency: String(raw.currency) } : {}),
      ...(raw.payment !== undefined ? { payment: String(raw.payment) } : {}),
      ...(Array.isArray(destinations) ? { destinations: destinations as NonNullable<TransactionCallback['destinations']> } : {}),
    };
  }

  throw new TypeError('Not a recognised Apirone callback payload');
}

/**
 * The exact acknowledgement Apirone waits for: HTTP 200, text/plain, body `*ok*`.
 * Anything else makes it retry on the next block.
 */
export function callbackOk(): Response {
  return new Response('*ok*', { status: 200, headers: { 'content-type': 'text/plain; charset=UTF-8' } });
}

/**
 * Looks for a shared secret you embedded yourself: `?secret=` on the callback URL, `data.secret`
 * in the wallet/address callback data, or an `x-callback-secret` header.
 * Apirone does not sign callbacks; this is what stops strangers from POSTing fake payments.
 */
export function extractSecret(cb: ApironeCallback, request?: Request): string | undefined {
  const fromRaw = cb.raw.secret;
  if (typeof fromRaw === 'string') return fromRaw;
  const data = cb.kind === 'transaction' ? cb.data : undefined;
  if (data && typeof data.secret === 'string') return data.secret;
  return request?.headers.get('x-callback-secret') ?? undefined;
}

export function verifyCallbackSecret(cb: ApironeCallback, expected: string, request?: Request): boolean {
  const got = extractSecret(cb, request);
  return got !== undefined && safeEqual(got, expected);
}

export interface CallbackContext<Env = unknown> {
  request: Request;
  env: Env | undefined;
}

export interface CallbackHandlerOptions<Env = unknown> {
  /** Shared secret to require, or a function reading it from `env` (recommended: a Worker secret). */
  secret?: string | ((env: Env | undefined) => string | undefined);
  onTransaction?: (cb: TransactionCallback, c: CallbackContext<Env>) => void | Promise<void>;
  onInvoice?: (cb: InvoiceCallback, c: CallbackContext<Env>) => void | Promise<void>;
  onForwarding?: (cb: ForwardingCallback, c: CallbackContext<Env>) => void | Promise<void>;
  /**
   * Acknowledge immediately and run handlers in `ctx.waitUntil()`. Only use if your handler is
   * idempotent and safe to lose: a failure after `*ok*` will NOT be retried by Apirone.
   * Default false: handlers run before acknowledging, and a thrown error returns 500 so Apirone retries.
   */
  background?: boolean;
  onError?: (error: unknown, cb: ApironeCallback | undefined) => void;
}

export type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

/**
 * Returns a Worker-style handler `(request, env, ctx) => Response` for Apirone callbacks.
 *
 * ```ts
 * const handle = createCallbackHandler<Env>({
 *   secret: (env) => env?.CALLBACK_SECRET,
 *   onInvoice: async (cb) => { if (cb.status === 'completed') await fulfil(cb.invoice) },
 * });
 * ```
 */
export function createCallbackHandler<Env = unknown>(opts: CallbackHandlerOptions<Env>) {
  return async (request: Request, env?: Env, ctx?: WaitUntilCtx): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, POST' } });
    }

    let cb: ApironeCallback;
    try {
      cb = await parseCallback(request);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const expected = typeof opts.secret === 'function' ? opts.secret(env) : opts.secret;
    if (opts.secret !== undefined) {
      if (!expected) return new Response('Callback secret is not configured', { status: 500 });
      if (!verifyCallbackSecret(cb, expected, request)) return new Response('Forbidden', { status: 403 });
    }

    const c: CallbackContext<Env> = { request, env };
    const run = async () => {
      if (cb.kind === 'transaction') await opts.onTransaction?.(cb, c);
      else if (cb.kind === 'invoice') await opts.onInvoice?.(cb, c);
      else await opts.onForwarding?.(cb, c);
    };

    if (opts.background && ctx) {
      ctx.waitUntil(run().catch((e) => opts.onError?.(e, cb)));
      return callbackOk();
    }
    try {
      await run();
      return callbackOk();
    } catch (e) {
      opts.onError?.(e, cb);
      return new Response('Handler error', { status: 500 });
    }
  };
}
