import type { HttpClient } from '../http.js';
import type {
  Amount, AddressHistory, AddressInfo, AddressList, AddressType, CallbackInfo, CallbackLog,
  CallbackSpec, CallOptions, Currency, Destination, Estimation, FeeParams, GeneratedAddress,
  HistoryItem, HistoryItemType, HistoryList, PageParams, PaymentResult, ProcessingFeePolicy,
  SettingsResult, WalletAddressBalance, WalletBalance, WalletCreated, WalletInfo,
} from '../types.js';
import { buildFilter, formatDestinations, seg } from '../util.js';

export interface CreateWalletParams extends FeeParams {
  currency: Currency;
  callback?: CallbackSpec;
  destinations?: Destination[];
  destination_rules?: unknown[] | null;
  'processing-fee-policy'?: ProcessingFeePolicy;
}

export interface WalletEstimateParams extends FeeParams {
  destinations: string | Destination[];
  'subtract-fee-from-amount'?: boolean;
  addresses?: string[];
}

export interface WalletTransferParams extends FeeParams {
  destinations: Array<{ address: string; amount: Amount }>;
  'subtract-fee-from-amount'?: boolean;
  addresses?: string[];
}

export interface WalletSettings {
  'processing-fee-policy'?: ProcessingFeePolicy;
  callback?: CallbackSpec | null;
  destinations?: Destination[] | null;
  destination_rules?: unknown[] | null;
}

export class WalletsApi {
  constructor(private readonly http: HttpClient) {}

  /** POST /api/v2/wallets. Save the returned `transfer-key`. */
  create(params: CreateWalletParams, opts?: CallOptions): Promise<WalletCreated> {
    return this.http.request({ method: 'POST', path: '/api/v2/wallets', body: params, call: opts });
  }

  /** GET /api/v2/wallets/{wallet} */
  get(wallet: string, opts?: CallOptions): Promise<WalletInfo> {
    return this.http.request({ method: 'GET', path: `/api/v2/wallets/${seg(wallet)}`, call: opts });
  }

  /** GET /api/v2/wallets/{wallet}/balance */
  balance(wallet: string, params: { addresses?: string[] } = {}, opts?: CallOptions): Promise<WalletBalance> {
    return this.http.request({ method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/balance`, query: params, call: opts });
  }

  /** POST /api/v2/wallets/{wallet}/addresses */
  createAddress(
    wallet: string,
    body: { 'addr-type'?: AddressType; callback?: CallbackSpec } = {},
    opts?: CallOptions,
  ): Promise<GeneratedAddress> {
    return this.http.request({ method: 'POST', path: `/api/v2/wallets/${seg(wallet)}/addresses`, body, call: opts });
  }

  /** GET /api/v2/wallets/{wallet}/addresses/{address} */
  addressInfo(wallet: string, address: string, opts?: CallOptions): Promise<AddressInfo> {
    return this.http.request({ method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/addresses/${seg(address)}`, call: opts });
  }

  /** GET /api/v2/wallets/{wallet}/addresses/{address}/balance */
  addressBalance(wallet: string, address: string, opts?: CallOptions): Promise<WalletAddressBalance> {
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/addresses/${seg(address)}/balance`, call: opts,
    });
  }

  /** GET /api/v2/wallets/{wallet}/addresses */
  addresses(
    wallet: string,
    params: PageParams & { filter?: { address?: string; empty?: false } } = {},
    opts?: CallOptions,
  ): Promise<AddressList> {
    const { filter, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/addresses`, query: { ...rest, q: buildFilter(filter) }, call: opts,
    });
  }

  /** GET /api/v2/wallets/{wallet}/transfer: dry-run of a transfer. */
  estimate(wallet: string, params: WalletEstimateParams, opts?: CallOptions): Promise<Estimation> {
    const { destinations, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/transfer`,
      query: { ...rest, destinations: formatDestinations(destinations) }, call: opts,
    });
  }

  /** POST /api/v2/wallets/{wallet}/transfer. Protected. Moves real funds. */
  transfer(wallet: string, params: WalletTransferParams, opts?: CallOptions): Promise<PaymentResult> {
    return this.http.request({
      method: 'POST', path: `/api/v2/wallets/${seg(wallet)}/transfer`, body: params, authId: wallet, call: opts,
    });
  }

  /** GET /api/v2/wallets/{wallet}/history */
  history(
    wallet: string,
    params: PageParams & {
      addresses?: string[];
      filter?: { address?: string; 'date-from'?: string; 'date-to'?: string; 'item-type'?: HistoryItemType };
    } = {},
    opts?: CallOptions,
  ): Promise<HistoryList> {
    const { filter, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/history`, query: { ...rest, q: buildFilter(filter) }, call: opts,
    });
  }

  /** GET /api/v2/wallets/{wallet}/history/{id} */
  historyItem(wallet: string, id: string, opts?: CallOptions): Promise<HistoryItem> {
    return this.http.request({ method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/history/${seg(id)}`, call: opts });
  }

  /** GET /api/v2/wallets/{wallet}/addresses/{address}/history */
  addressHistory(wallet: string, address: string, params: PageParams = {}, opts?: CallOptions): Promise<AddressHistory> {
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/addresses/${seg(address)}/history`, query: params, call: opts,
    });
  }

  /** GET /api/v2/wallets/{wallet}/callback. Protected. */
  callbackInfo(wallet: string, opts?: CallOptions): Promise<CallbackInfo> {
    return this.http.request({ method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/callback`, authId: wallet, call: opts });
  }

  /** GET /api/v2/wallets/{wallet}/addresses/{address}/callback. Protected. */
  addressCallbackInfo(wallet: string, address: string, opts?: CallOptions): Promise<CallbackInfo> {
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/addresses/${seg(address)}/callback`, authId: wallet, call: opts,
    });
  }

  /** GET /api/v2/wallets/{wallet}/addresses/{address}/callback-log. Protected. */
  addressCallbackLog(wallet: string, address: string, params: PageParams = {}, opts?: CallOptions): Promise<CallbackLog> {
    return this.http.request({
      method: 'GET', path: `/api/v2/wallets/${seg(wallet)}/addresses/${seg(address)}/callback-log`,
      query: params, authId: wallet, call: opts,
    });
  }

  /** PATCH /api/v2/wallets/{wallet}. Protected. */
  updateSettings(wallet: string, settings: WalletSettings, opts?: CallOptions): Promise<SettingsResult> {
    return this.http.request({
      method: 'PATCH', path: `/api/v2/wallets/${seg(wallet)}`, body: settings, authId: wallet, call: opts,
    });
  }
}
