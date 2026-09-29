import { HttpClient, type ClientOptions, type HttpRequest } from './http.js';
import { AccountsApi } from './resources/accounts.js';
import { InvoicesApi } from './resources/invoices.js';
import { AuthApi, ForwardingApi, NetworkApi, ServiceApi, TickerApi } from './resources/misc.js';
import { WalletsApi } from './resources/wallets.js';

/**
 * Apirone API client. Create it once at module scope and reuse it across requests so the JWT
 * cache (authMode: 'jwt') survives for the life of the isolate.
 *
 * ```ts
 * const apirone = new Apirone({ transferKey: (id) => env[`KEY_${id}`] });
 * const invoice = await apirone.invoices.create(accountId, { currency: 'btc', amount: '50000' });
 * ```
 */
export class Apirone {
  readonly accounts: AccountsApi;
  readonly wallets: WalletsApi;
  readonly invoices: InvoicesApi;
  readonly auth: AuthApi;
  readonly service: ServiceApi;
  readonly network: NetworkApi;
  readonly ticker: TickerApi;
  readonly forwarding: ForwardingApi;
  /** Low-level access, e.g. for endpoints Apirone adds before this package does. */
  readonly http: HttpClient;

  constructor(options: ClientOptions = {}) {
    this.http = new HttpClient(options);
    this.accounts = new AccountsApi(this.http);
    this.wallets = new WalletsApi(this.http);
    this.invoices = new InvoicesApi(this.http);
    this.auth = new AuthApi(this.http);
    this.service = new ServiceApi(this.http);
    this.network = new NetworkApi(this.http);
    this.ticker = new TickerApi(this.http);
    this.forwarding = new ForwardingApi(this.http);
  }

  /** Escape hatch: call any Apirone endpoint with the client's auth, retries and error handling. */
  request<T = unknown>(req: HttpRequest): Promise<T> {
    return this.http.request<T>(req);
  }
}

export function createApirone(options: ClientOptions = {}): Apirone {
  return new Apirone(options);
}
