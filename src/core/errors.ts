/** Thrown for every non-2xx response, network failure and timeout. `transfer-key` is never included. */
export class ApironeError extends Error {
  override name = 'ApironeError';
  /** HTTP status, or 0 for network failures and timeouts. */
  readonly status: number;
  readonly method: string;
  /** Request URL with any transfer-key redacted. */
  readonly url: string;
  /** Parsed JSON body when available, otherwise the raw text. */
  readonly body: unknown;
  readonly code: 'http' | 'network' | 'timeout' | 'aborted';
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    message: string;
    status: number;
    method: string;
    url: string;
    body?: unknown;
    code?: ApironeError['code'];
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
    this.code = init.code ?? 'http';
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isBadRequest() { return this.status === 400; }
  get isUnauthorized() { return this.status === 401; }
  get isNotFound() { return this.status === 404; }
  get isConflict() { return this.status === 409; }
  get isRateLimited() { return this.status === 429; }
  get isServerError() { return this.status >= 500; }
}

const SECRET_QUERY = /([?&](?:transfer-key|password)=)[^&#]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SECRET_QUERY, '$1[redacted]');
}
