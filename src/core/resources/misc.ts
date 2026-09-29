import type { HttpClient } from '../http.js';
import type {
  AuthTokens, CallOptions, Currency, ForwardingAddress, NetworkFeeRate, ServiceInfo,
  TickerMulti, TickerSingle,
} from '../types.js';
import { seg } from '../util.js';

/** Raw JWT endpoints. Usually you don't need these: set `authMode: 'jwt'` on the client instead. */
export class AuthApi {
  constructor(private readonly http: HttpClient) {}

  /** POST /api/v2/auth/login. `login` is an account/wallet id, `password` its transfer key. */
  login(login: string, password: string, opts?: CallOptions): Promise<AuthTokens> {
    return this.http.request({ method: 'POST', path: '/api/v2/auth/login', body: { login, password }, call: opts });
  }

  /** POST /api/v2/auth/refresh-token */
  refresh(refreshToken: string, opts?: CallOptions): Promise<AuthTokens> {
    return this.http.request({
      method: 'POST', path: '/api/v2/auth/refresh-token', headers: { authorization: `Bearer ${refreshToken}` }, call: opts,
    });
  }

  /** POST /api/v2/auth/logout. Invalidates the tokens issued for this login. */
  logout(accessToken: string, opts?: CallOptions): Promise<Record<string, never>> {
    return this.http.request({
      method: 'POST', path: '/api/v2/auth/logout', headers: { authorization: `Bearer ${accessToken}` }, call: opts,
    });
  }
}

export class ServiceApi {
  constructor(private readonly http: HttpClient) {}

  /** OPTIONS /api/v2/{accounts|wallets}: supported currencies, address types, fees, confirmations. */
  info(type: 'accounts' | 'wallets' = 'accounts', opts?: CallOptions): Promise<ServiceInfo> {
    return this.http.request({ method: 'OPTIONS', path: `/api/v2/${type}`, call: opts });
  }
}

export class NetworkApi {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v2/networks/{currency}/fee: current recommended fee rates. */
  fee(currency: Currency, opts?: CallOptions): Promise<NetworkFeeRate[]> {
    return this.http.request({ method: 'GET', path: `/api/v2/networks/${seg(currency)}/fee`, call: opts });
  }
}

export class TickerApi {
  constructor(private readonly http: HttpClient) {}

  /** One crypto, all fiats: `{ aed: .., usd: .. }`. */
  get(params: { currency: Currency }, opts?: CallOptions): Promise<TickerSingle>;
  /** One crypto, one fiat: `{ usd: .. }`. */
  get(params: { currency: Currency; fiat: string }, opts?: CallOptions): Promise<TickerSingle>;
  /** Several cryptos (fiat is required): `{ btc: { usd: .. }, ltc: { usd: .. } }`. */
  get(params: { currency: Currency[]; fiat: string }, opts?: CallOptions): Promise<TickerMulti>;
  get(params: { currency: Currency | Currency[]; fiat?: string }, opts?: CallOptions): Promise<TickerSingle | TickerMulti> {
    return this.http.request({
      method: 'GET', path: '/api/v2/ticker',
      query: { currency: params.currency, fiat: params.fiat?.toLowerCase() }, call: opts,
    });
  }
}

export class ForwardingApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/receive (Simple Forwarding v1). Returns a deposit address whose incoming payments are
   * forwarded to `address`. The callback is appended last and unencoded, as the API requires, so put
   * your own query params (e.g. `?order=1&secret=...`) inside the callback URL. Callbacks arrive as GET.
   */
  create(
    params: { address: string; callback: string; currency?: Currency },
    opts?: CallOptions,
  ): Promise<ForwardingAddress> {
    if (!/^https?:\/\//i.test(params.callback)) {
      throw new TypeError('callback must be an http(s) URL');
    }
    return this.http.request({
      method: 'GET', path: '/api/v1/receive',
      query: { method: 'create', address: params.address, currency: params.currency },
      rawQueryTail: `callback=${params.callback}`,
      call: opts,
    });
  }
}
