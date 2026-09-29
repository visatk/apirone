# apirone-workerd

[Apirone](https://apirone.com/docs/) crypto payments API client for **Cloudflare Workers** (workerd).
Every documented endpoint, typed, with zero runtime dependencies. It uses only `fetch` and Web APIs,
so **it does not need the `nodejs_compat` flag**.

```sh
npm i apirone-workerd
```

```ts
import { Apirone } from 'apirone-workerd';

const apirone = new Apirone({ transferKey: env.APIRONE_TRANSFER_KEY });

const invoice = await apirone.invoices.create('apr-...', {
  currency: 'usdt@trx',
  amount: '5000000',        // minor units, as a string (5.00 USDT)
  lifetime: 3600,
  'callback-url': 'https://shop.example/apirone/callback?secret=...',
});
// send the customer to invoice['invoice-url']
```

## How the package is "workerd-specific"

`package.json` uses [conditional exports](https://nodejs.org/api/packages.html#conditional-exports):

```jsonc
"exports": { ".": {
  "workerd": "./dist/entries/workerd.js",   // wrangler, Miniflare, vitest-pool-workers
  "worker":  "./dist/entries/workerd.js",
  "node":    "./dist/entries/node.js",
  "import":  "./dist/entries/node.js",
  "default": "./dist/entries/node.js"
}}
```

Both builds share one portable core (`fetch`, `URL`, `Headers`, `TextEncoder`, `atob`). The `workerd`
build adds Workers-only extras: `KVTokenStore` (share JWTs across isolates via Workers KV) and
`fetcherToFetch` (route traffic through a service binding). The workerd build never imports `node:*`;
`npm run check:bundle` enforces that, and a real `wrangler deploy --dry-run` bundles it with no
compatibility flags. Enable `nodejs_compat` only if *your own* code needs it.

TypeScript: set `"customConditions": ["workerd", "worker"]` with `"moduleResolution": "Bundler"` to
resolve the workerd typings. See `examples/worker`.

## API surface

| Namespace | Methods |
|---|---|
| `apirone.accounts` | `create`, `get`, `balance`, `createAddress`, `addressInfo`, `addressBalance`, `addresses`, `estimate`, `transfer`*, `history`, `historyItem`, `addressHistory`, `callbackInfo`*, `addressCallbackInfo`*, `addressCallbackLog`*, `updateSettings`* |
| `apirone.wallets` | `create`, `get`, `balance`, `createAddress`, `addressInfo`, `addressBalance`, `addresses`, `estimate`, `transfer`*, `history`, `historyItem`, `addressHistory`, `callbackInfo`*, `addressCallbackInfo`*, `addressCallbackLog`*, `updateSettings`* |
| `apirone.invoices` | `create`, `get` (public), `getPrivate`*, `list`* |
| `apirone.auth` | `login`, `refresh`, `logout` |
| `apirone.service` | `info('accounts' \| 'wallets')` (HTTP OPTIONS) |
| `apirone.network` | `fee(currency)` |
| `apirone.ticker` | `get({ currency, fiat? })`, multi-currency supported |
| `apirone.forwarding` | `create({ address, callback, currency? })` (Simple Forwarding v1) |
| `apirone.request()` | escape hatch for any endpoint |

\* protected endpoint: needs a transfer key or JWT.

## Authentication

Protected endpoints accept a **transfer key** or a **JWT**. The default sends the key exactly as the
docs describe: in the JSON body for POST/PATCH, in the query string for GET.

```ts
new Apirone({ transferKey: 'key' });                           // one key
new Apirone({ transferKey: { 'apr-1': 'k1', 'btc-2': 'k2' } }); // per account/wallet id
new Apirone({ transferKey: (id) => env[`KEY_${id}`] });         // resolver
await apirone.accounts.transfer(id, params, { transferKey: 'x' }); // per call
await apirone.invoices.list(id, {}, { accessToken: jwt });        // your own JWT
```

**`authMode: 'jwt'`** exchanges the key for a ~10 minute JWT once, caches it, refreshes it, and sends
`Authorization: Bearer`. The key then never appears in a URL. A stale cached token gets one automatic
re-login on a 401. Use `KVTokenStore` to share tokens between isolates:

```ts
import { Apirone, KVTokenStore } from 'apirone-workerd';
const apirone = new Apirone({ transferKey: env.KEY, authMode: 'jwt', tokenStore: new KVTokenStore(env.TOKENS) });
```

Create the client at module scope (not per request) so the in-memory cache lives as long as the isolate.

## Receiving callbacks

Apirone retries callbacks each block until it gets HTTP 200 `text/plain` with body `*ok*`.
Callbacks come from `callback.apirone.com` and **are not signed**, so embed a secret yourself.

```ts
import { createCallbackHandler } from 'apirone-workerd';

const handle = createCallbackHandler<Env>({
  secret: (env) => env?.CALLBACK_SECRET,        // ?secret=... on the URL, data.secret, or x-callback-secret header
  onInvoice: async (cb) => { /* cb.invoice, cb.status */ },
  onTransaction: async (cb) => { /* cb.value, cb.confirmations, cb.data */ },
  onForwarding: async (cb) => { /* Simple Forwarding v1 GET callbacks */ },
});

export default { fetch: (req, env, ctx) => handle(req, env, ctx) };
```

- A handler that throws returns **500**, so Apirone retries. `background: true` acknowledges first and
  runs your code in `ctx.waitUntil`. Only use it if losing a failure is acceptable.
- Callbacks repeat per confirmation count: make handlers **idempotent** (key on
  `input_transaction_hash` + `confirmations`, or on invoice id + status).
- Don't fulfil on unconfirmed payments (the docs warn about double-spends). For invoices, wait for
  `completed` (`isInvoiceConfirmed`) and re-fetch with `invoices.get()` instead of trusting the body alone.
- Allow-list `callback.apirone.com` if you have a firewall in front of your Worker.

## Amounts and precision

Amounts are minor units (satoshi, wei, ...). Send **strings or `bigint`**; `bigint` is serialised to a string.
The API returns amounts as JSON numbers, and `JSON.parse` cannot represent wei-sized values exactly.
Parsed callback values above 2^53 are kept as strings, but **API response bodies are plain `JSON.parse`**,
so treat large ETH/BNB/USDT@BNB figures in responses with care (`toBigInt()` throws on unsafe numbers
instead of silently rounding).

## Behaviour

- `GET`/`OPTIONS` retry on network errors, 429 and 503 (default 2 retries, honours `Retry-After`).
  Writes are **never** retried, so a `transfer` can't be sent twice.
- 15 s per-attempt timeout (`timeoutMs`), and `signal` per call.
- Every failure is an `ApironeError` with `status`, `body`, `code` and helpers like `isUnauthorized`.
  Transfer keys are redacted from `error.url` and `error.message`.
- `fetch` is called unbound (storing it on an object and calling it as a method throws
  "Illegal invocation" in workerd).

## Docs inconsistencies I worked around

The Apirone docs disagree with themselves in places. Verify against your account, ideally on the
`tbtc` testnet, before going live:

| Where | Docs say | This package sends |
|---|---|---|
| Invoice callback param | table: `callback-url`; curl example: `callback_url` | `callback-url` (matches the response field) |
| History filter keys | tables: `date-from`, `item-type`; curl example: `date_from`, `item_type` | keys exactly as you pass them, typed as the table (kebab) |
| Invoice list filter keys | `date_from`, `date_to`, `status` | as documented (snake) |
| Ack body | `*ok*` | literal `*ok*` |

If one of these is wrong for your account, use the `apirone.request()` escape hatch or open an issue.

## Development

```sh
npm install
npm test               # build + 32 tests (mock fetch, no network)
npm run check:bundle   # no node: imports reachable from the workerd entry
```

## Status

Built from the public Apirone docs (September 2026). Tested with a mocked `fetch`, bundled with
Wrangler 4.143 without `nodejs_compat`, and smoke-tested in local workerd (callback endpoint). It has
**not** been run against the live Apirone API. Start with a testnet wallet.
