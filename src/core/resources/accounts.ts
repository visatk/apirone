import type { HttpClient } from '../http.js';
import type {
  AccountAddressBalance, AccountBalance, AccountCreated, AccountInfo, Amount, AddressHistory,
  AddressInfo, AddressList, AddressType, CallbackInfo, CallbackLog, CallbackSpec, CallOptions,
  Currency, Destination, Estimation, FeeParams, GeneratedAddress, HistoryItem, HistoryItemType,
  HistoryList, PageParams, PaymentResult, Profile, SettingsResult,
} from '../types.js';
import { buildFilter, formatDestinations, seg } from '../util.js';

export interface EstimateParams extends FeeParams {
  currency: Currency;
  destinations: string | Destination[];
  'subtract-fee-from-amount'?: boolean;
  /** Only spend from these addresses. */
  addresses?: string[];
}

export interface TransferParams extends FeeParams {
  currency: Currency;
  destinations: Array<{ address: string; amount: Amount }>;
  'subtract-fee-from-amount'?: boolean;
  addresses?: string[];
}

export interface AccountSettings {
  /** Required by the API. */
  currency: Currency;
  'processing-fee-policy'?: 'fixed' | 'percentage';
  callback?: CallbackSpec | null;
  destinations?: Destination[] | null;
  destination_rules?: unknown[] | null;
  profile?: Profile;
}

export class AccountsApi {
  constructor(private readonly http: HttpClient) {}

  /** POST /api/v2/accounts. Save the returned `transfer-key`: it is shown once. */
  create(profile?: Profile, opts?: CallOptions): Promise<AccountCreated> {
    return this.http.request({ method: 'POST', path: '/api/v2/accounts', body: profile ? { profile } : {}, call: opts });
  }

  /** GET /api/v2/accounts/{account} */
  get(account: string, params: { currency?: Currency } = {}, opts?: CallOptions): Promise<AccountInfo> {
    return this.http.request({ method: 'GET', path: `/api/v2/accounts/${seg(account)}`, query: params, call: opts });
  }

  /** GET /api/v2/accounts/{account}/balance */
  balance(
    account: string,
    params: { currency?: Currency; addresses?: string[] } = {},
    opts?: CallOptions,
  ): Promise<AccountBalance> {
    return this.http.request({ method: 'GET', path: `/api/v2/accounts/${seg(account)}/balance`, query: params, call: opts });
  }

  /** POST /api/v2/accounts/{account}/addresses */
  createAddress(
    account: string,
    body: { currency: Currency; 'addr-type'?: AddressType; callback?: CallbackSpec },
    opts?: CallOptions,
  ): Promise<GeneratedAddress> {
    return this.http.request({ method: 'POST', path: `/api/v2/accounts/${seg(account)}/addresses`, body, call: opts });
  }

  /** GET /api/v2/accounts/{account}/addresses/{address}. `currency` is required for token addresses. */
  addressInfo(account: string, address: string, params: { currency?: Currency } = {}, opts?: CallOptions): Promise<AddressInfo> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/addresses/${seg(address)}`, query: params, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/addresses/{address}/balance */
  addressBalance(
    account: string, address: string, params: { currency?: Currency } = {}, opts?: CallOptions,
  ): Promise<AccountAddressBalance> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/addresses/${seg(address)}/balance`, query: params, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/addresses. `filter.empty: false` hides zero-balance addresses. */
  addresses(
    account: string,
    params: PageParams & { currency: Currency; filter?: { address?: string; empty?: false } },
    opts?: CallOptions,
  ): Promise<AddressList> {
    const { filter, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/addresses`,
      query: { ...rest, q: buildFilter(filter) }, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/transfer: dry-run of a transfer. */
  estimate(account: string, params: EstimateParams, opts?: CallOptions): Promise<Estimation> {
    const { destinations, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/transfer`,
      query: { ...rest, destinations: formatDestinations(destinations) }, call: opts,
    });
  }

  /** POST /api/v2/accounts/{account}/transfer. Protected. Moves real funds. */
  transfer(account: string, params: TransferParams, opts?: CallOptions): Promise<PaymentResult> {
    return this.http.request({
      method: 'POST', path: `/api/v2/accounts/${seg(account)}/transfer`, body: params, authId: account, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/history */
  history(
    account: string,
    params: PageParams & {
      currency?: Currency;
      filter?: { address?: string; 'date-from'?: string; 'date-to'?: string; 'item-type'?: HistoryItemType };
    } = {},
    opts?: CallOptions,
  ): Promise<HistoryList> {
    const { filter, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/history`,
      query: { ...rest, q: buildFilter(filter) }, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/history/{id} */
  historyItem(account: string, id: string, opts?: CallOptions): Promise<HistoryItem> {
    return this.http.request({ method: 'GET', path: `/api/v2/accounts/${seg(account)}/history/${seg(id)}`, call: opts });
  }

  /** GET /api/v2/accounts/{account}/addresses/{address}/history */
  addressHistory(
    account: string, address: string, params: PageParams & { currency?: Currency } = {}, opts?: CallOptions,
  ): Promise<AddressHistory> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/addresses/${seg(address)}/history`, query: params, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/callback?currency=. Protected. */
  callbackInfo(account: string, currency: Currency, opts?: CallOptions): Promise<CallbackInfo> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/callback`, query: { currency }, authId: account, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/addresses/{address}/callback. Protected. */
  addressCallbackInfo(account: string, address: string, opts?: CallOptions): Promise<CallbackInfo> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/addresses/${seg(address)}/callback`, authId: account, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/addresses/{address}/callback-log. Protected. */
  addressCallbackLog(account: string, address: string, params: PageParams = {}, opts?: CallOptions): Promise<CallbackLog> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/addresses/${seg(address)}/callback-log`,
      query: params, authId: account, call: opts,
    });
  }

  /** PATCH /api/v2/accounts/{account}. Protected. Callback, forwarding destinations, fee policy, profile. */
  updateSettings(account: string, settings: AccountSettings, opts?: CallOptions): Promise<SettingsResult> {
    return this.http.request({
      method: 'PATCH', path: `/api/v2/accounts/${seg(account)}`, body: settings, authId: account, call: opts,
    });
  }
}
