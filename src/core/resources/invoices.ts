import type { HttpClient } from '../http.js';
import type {
  Amount, CallOptions, Currency, Invoice, InvoiceList, InvoiceStatus, InvoiceUserData, PageParams,
} from '../types.js';
import { buildFilter, seg } from '../util.js';

export interface CreateInvoiceParams {
  currency: Currency;
  /** Minor units; omit for an open-amount invoice. Strings recommended. */
  amount?: Amount;
  /** Seconds. */
  lifetime?: number;
  /** ISO-8601. Wins over `lifetime` if both are set. */
  expire?: string;
  /** Receives a POST on every status change. */
  'callback-url'?: string;
  'user-data'?: InvoiceUserData;
  /** Customer is redirected here after payment. */
  linkback?: string;
}

export class InvoicesApi {
  constructor(private readonly http: HttpClient) {}

  /** POST /api/v2/accounts/{account}/invoices */
  create(account: string, params: CreateInvoiceParams, opts?: CallOptions): Promise<Invoice> {
    return this.http.request({ method: 'POST', path: `/api/v2/accounts/${seg(account)}/invoices`, body: params, call: opts });
  }

  /** GET /api/v2/invoices/{invoice}: public, no credentials. */
  get(invoice: string, opts?: CallOptions): Promise<Invoice> {
    return this.http.request({ method: 'GET', path: `/api/v2/invoices/${seg(invoice)}`, call: opts });
  }

  /** GET /api/v2/accounts/{account}/invoices/{invoice}: includes callback info. Protected. */
  getPrivate(account: string, invoice: string, opts?: CallOptions): Promise<Invoice> {
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/invoices/${seg(invoice)}`, authId: account, call: opts,
    });
  }

  /** GET /api/v2/accounts/{account}/invoices. Protected. */
  list(
    account: string,
    params: PageParams & { filter?: { status?: InvoiceStatus; date_from?: string; date_to?: string } } = {},
    opts?: CallOptions,
  ): Promise<InvoiceList> {
    const { filter, ...rest } = params;
    return this.http.request({
      method: 'GET', path: `/api/v2/accounts/${seg(account)}/invoices`,
      query: { ...rest, q: buildFilter(filter) }, authId: account, call: opts,
    });
  }
}

/** True once the customer has sent at least the full amount (paid, overpaid or completed). */
export function isInvoicePaidInFull(status: InvoiceStatus): boolean {
  return status === 'paid' || status === 'overpaid' || status === 'completed';
}

/**
 * `completed` means the payment reached the network's required confirmations. Docs warn against
 * fulfilling orders on unconfirmed transactions, so fulfil on this, not on `paid`.
 */
export function isInvoiceConfirmed(status: InvoiceStatus): boolean {
  return status === 'completed';
}
