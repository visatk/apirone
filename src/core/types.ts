/** Currencies listed in the Apirone docs. `tbtc` (testnet) is accepted by wallets/service info. */
export type KnownCurrency =
  | 'btc' | 'tbtc' | 'ltc' | 'bch' | 'doge'
  | 'trx' | 'usdt@trx' | 'usdc@trx'
  | 'eth' | 'usdt@eth' | 'usdc@eth'
  | 'bnb' | 'usdt@bnb' | 'usdc@bnb'
  | 'gram' | 'usdt@ton';

export type Currency = KnownCurrency | (string & {});

export const CURRENCIES: readonly KnownCurrency[] = [
  'btc', 'tbtc', 'ltc', 'bch', 'doge', 'trx', 'usdt@trx', 'usdc@trx',
  'eth', 'usdt@eth', 'usdc@eth', 'bnb', 'usdt@bnb', 'usdc@bnb', 'gram', 'usdt@ton',
];

/**
 * Amounts are in minor units (satoshi, wei, ...). Prefer strings or bigint: wei values exceed
 * Number.MAX_SAFE_INTEGER and Apirone recommends string amounts.
 */
export type Amount = string | number | bigint;
/** Amounts as returned by the API. Large values (wei) may exceed double precision, see README. */
export type Units = number | string;

export type FeeStrategy = 'normal' | 'priority' | 'custom';
export type ProcessingFeePolicy = 'fixed' | 'percentage';
export type InvoiceStatus = 'created' | 'paid' | 'partpaid' | 'overpaid' | 'completed' | 'expired';
export type AddressType = 'p2pkh' | 'p2pkh(c)' | 'p2wpkh' | 'p2sh-p2wpkh' | 'generic' | (string & {});
export type HistoryItemType = 'payment' | 'receipt';
export type ISODate = string;

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'created', 'paid', 'partpaid', 'overpaid', 'completed', 'expired',
];

/** Fee selection. `fee-rate` is required for `custom`; `priority-fee` is for Ethereum. */
export interface FeeParams {
  fee?: FeeStrategy;
  'fee-rate'?: number;
  'priority-fee'?: number;
}

export interface CallbackSpec {
  method?: 'GET' | 'POST' | (string & {});
  /** Valid URL, shorter than 1024 characters. */
  url: string;
  data?: Record<string, unknown>;
}

export interface Destination {
  address: string;
  /** Integer minor units or a percentage such as "50%". Omit on wallet/account settings for the remainder. */
  amount?: Amount;
}

export interface Pagination { total: number; offset: number; limit: number }
export type PageParams = { limit?: number; offset?: number };

export interface Profile {
  first_name?: string;
  last_name?: string;
  email?: string;
  send_updates?: boolean;
  /** ISO 3166-1 alpha-3 */
  country?: string;
  org_type?: string;
}

/** Credentials that override client defaults for a single call. */
export interface AuthOption {
  /** Sent in the body (POST/PATCH) or query string (GET) unless the client uses JWT mode. */
  transferKey?: string;
  /** JWT access token, sent as `Authorization: Bearer`. Takes precedence over transferKey. */
  accessToken?: string;
}
export interface CallOptions extends AuthOption { signal?: AbortSignal }

// ---------- Responses ----------

export interface AccountCreated {
  account: string;
  created: ISODate;
  'transfer-key': string;
  profile?: Profile;
}

export interface CurrencyInfo {
  currency: Currency;
  created: ISODate;
  units: string;
  fee: FeeStrategy;
  'fee-rate'?: number;
  'processing-fee-policy': ProcessingFeePolicy;
  'default-fiat'?: string;
  destinations: Destination[] | null;
  destination_rules: unknown[] | null;
}
export interface AccountInfo { account: string; info: CurrencyInfo[] }

export interface WalletCreated {
  wallet: string;
  created: ISODate;
  currency: Currency;
  'transfer-key': string;
  callback?: CallbackSpec | null;
  destinations: Destination[] | null;
  destination_rules: unknown[] | null;
  fee: FeeStrategy;
  'processing-fee-policy': ProcessingFeePolicy;
}
export interface WalletInfo {
  wallet: string;
  currency: Currency;
  created: ISODate;
  units: string;
  'processing-fee-policy': ProcessingFeePolicy;
  destinations: Destination[] | null;
  destination_rules: unknown[] | null;
  fee: FeeStrategy;
}

export interface AddressBalance { available: Units; total: Units }
export interface AccountBalance {
  account: string;
  balance: Array<{ currency: Currency } & AddressBalance>;
}
export interface WalletBalance extends AddressBalance { wallet: string }
export interface AccountAddressBalance extends AddressBalance { account: string; currency: Currency; address: string }
export interface WalletAddressBalance extends AddressBalance { wallet: string; address: string }

export interface GeneratedAddress {
  account?: string;
  wallet?: string;
  currency?: Currency;
  address: string;
  created: ISODate;
  type: AddressType;
  callback?: CallbackSpec | null;
}
export interface AddressInfo {
  account?: string;
  wallet?: string;
  currency?: Currency;
  address: string;
  type: AddressType;
  created: ISODate;
  balance: AddressBalance;
}
export interface AddressList {
  account?: string;
  wallet?: string;
  currency?: Currency;
  addresses: Array<Omit<AddressInfo, 'account' | 'wallet'>>;
  pagination: Pagination;
}

export interface FeeBreakdown {
  'subtract-from-amount': boolean;
  processing?: { address: string; amount: Units };
  network: { strategy: FeeStrategy; amount: Units; rate: number };
}
export interface Estimation {
  account?: string;
  wallet?: string;
  currency?: Currency;
  destinations: Array<{ address: string; amount: Units }>;
  amount: Units;
  total: Units;
  fee: FeeBreakdown;
}
export interface PaymentResult {
  account?: string;
  wallet?: string;
  currency?: Currency;
  created: ISODate;
  type: 'payment';
  id: string;
  txs: string[];
  destinations: Array<{ address: string; amount: Units }>;
  amount: Units;
  total: Units;
  fee: FeeBreakdown;
  'change-address'?: string;
}

export interface HistoryEntry {
  id: string;
  date: ISODate;
  type: HistoryItemType;
  currency?: Currency;
  txs?: string[];
  is_confirmed: boolean;
  amount: Units;
}
export interface HistoryList {
  account?: string;
  wallet?: string;
  items: HistoryEntry[];
  pagination: Pagination;
}
export interface BlockRef { hash: string; height: number; deleted: boolean }
export interface ReceiptItem {
  txid: string; address: string; amount: Units; block: BlockRef; is_confirmed: boolean;
}
export type HistoryItem =
  | (Omit<PaymentResult, 'change-address'>)
  | {
      account?: string; wallet?: string; currency?: Currency; created: ISODate;
      type: 'receipt'; id: string; items: ReceiptItem[]; amount: Units;
    };
export interface AddressHistory {
  account?: string; wallet?: string; currency?: Currency; address: string;
  txs: Array<{ txid: string; created: ISODate; amount: Units; block: BlockRef; deleted: boolean }>;
  pagination?: Pagination;
}

export interface CallbackInfo {
  account?: string; wallet?: string; currency?: Currency; address?: string;
  callback: CallbackSpec | null;
}
export interface CallbackLog {
  account?: string; wallet?: string; currency?: Currency; address: string;
  log: Array<{
    date: ISODate;
    request: { method: string; url: string; args: Record<string, unknown> };
    response: { status: number; headers: Record<string, string>; content: string };
  }>;
  pagination?: Pagination;
}

export interface SettingsResult {
  account?: string;
  wallet?: string;
  currency: Currency;
  created: ISODate;
  units: string;
  fee: FeeStrategy;
  'fee-rate'?: number;
  'processing-fee-policy': ProcessingFeePolicy;
  destinations: Destination[] | null;
  destination_rules: unknown[] | null;
  callback: CallbackSpec | null;
  profile?: Profile;
}

export interface InvoiceItem { name: string; cost: string; qty: number; total: string }
export interface InvoiceExtra { name: string; price: string }
export interface InvoiceUserData {
  title?: string; merchant?: string; url?: string; price?: string; 'sub-price'?: string;
  items?: InvoiceItem[]; extras?: InvoiceExtra[];
  [key: string]: unknown;
}
export interface InvoiceHistoryEntry { date: ISODate; status: InvoiceStatus; txid?: string; amount?: Units }
export interface Invoice {
  invoice: string;
  account?: string;
  created: ISODate;
  currency: Currency;
  amount?: Units;
  expire: ISODate;
  address: string;
  'callback-url'?: string;
  'user-data'?: InvoiceUserData;
  history: InvoiceHistoryEntry[];
  linkback?: string;
  status: InvoiceStatus;
  'invoice-url': string;
}
export interface InvoiceList {
  account: string; date_from: ISODate; date_to: ISODate;
  items: Array<{ invoice: string; created: ISODate; currency: Currency; amount: Units; status: InvoiceStatus }>;
  pagination: Pagination;
}

export interface CurrencyService {
  name: string;
  abbr: Currency;
  units: string;
  'units-factor': number;
  'address-types': AddressType[];
  'default-address-type': AddressType;
  'minimal-confirmations': number;
  'processing-fee': Record<ProcessingFeePolicy, Record<string, Units>>;
  'fee-free-limit': Units;
  'dust-rate': Units;
  token: string | null;
  network: string;
}
export interface ServiceInfo {
  'supported-fee-policies': FeeStrategy[];
  currencies: CurrencyService[];
  'invoice-valid-statuses'?: InvoiceStatus[];
}

export interface NetworkFeeRate { strategy: FeeStrategy; rate: number }
/** Map of fiat code to price, e.g. `{ usd: 56716.86 }`. */
export type TickerSingle = Record<string, number>;
/** `{ btc: { usd: 1 }, ltc: { usd: 2 } }` */
export type TickerMulti = Record<string, Record<string, number>>;

export interface AuthTokens { login: string; 'access-token': string; 'refresh-token': string }

export interface ForwardingAddress {
  destination: string;
  input_address: string;
  callback_url: string;
}
