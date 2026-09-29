import test from 'node:test';
import assert from 'node:assert/strict';
import { Apirone, ApironeError, MemoryTokenStore } from '../dist/entries/node.js';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function mock(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {
      url,
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { fetch, calls };
}

// Unsigned JWT-shaped token with a given exp (seconds).
const jwt = (expSec) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b({ exp: expSec })}.sig`;
};

test('public GET builds path + query, no credentials', async () => {
  const { fetch, calls } = mock(() => json({ usd: 1 }));
  const a = new Apirone({ fetch });
  await a.ticker.get({ currency: 'btc', fiat: 'USD' });
  assert.equal(calls[0].url, 'https://apirone.com/api/v2/ticker?currency=btc&fiat=usd');
  assert.equal(calls[0].method, 'GET');
});

test('multiple tickers are comma separated', async () => {
  const { fetch, calls } = mock(() => json({}));
  await new Apirone({ fetch }).ticker.get({ currency: ['btc', 'ltc'], fiat: 'usd' });
  assert.match(calls[0].url, /currency=btc%2Cltc&fiat=usd/);
});

test('token currency is URL-encoded and filters use q=key:value', async () => {
  const { fetch, calls } = mock(() => json({ addresses: [], pagination: {} }));
  await new Apirone({ fetch }).accounts.addresses('apr-1', {
    currency: 'usdt@trx', limit: 5, filter: { empty: false, address: 'T9' },
  });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, '/api/v2/accounts/apr-1/addresses');
  assert.equal(u.searchParams.get('currency'), 'usdt@trx');
  assert.equal(u.searchParams.get('q'), 'empty:false,address:T9');
  assert.equal(u.searchParams.get('limit'), '5');
});

test('transfer puts transfer-key in the JSON body (never the URL) and stringifies bigint', async () => {
  const { fetch, calls } = mock(() => json({ id: 'x', txs: [] }));
  const a = new Apirone({ fetch, transferKey: { 'apr-1': 'KEY1' } });
  await a.accounts.transfer('apr-1', {
    currency: 'eth',
    destinations: [{ address: '0xabc', amount: 1_000_000_000_000_000_000n }],
    fee: 'normal',
  });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://apirone.com/api/v2/accounts/apr-1/transfer');
  assert.equal(calls[0].body['transfer-key'], 'KEY1');
  assert.equal(calls[0].body.destinations[0].amount, '1000000000000000000');
});

test('protected GET puts transfer-key in the query; per-call override wins', async () => {
  const { fetch, calls } = mock(() => json({ callback: null }));
  const a = new Apirone({ fetch, transferKey: () => 'DEFAULT' });
  await a.wallets.callbackInfo('btc-1');
  await a.wallets.callbackInfo('btc-1', { transferKey: 'OVERRIDE' });
  assert.match(calls[0].url, /transfer-key=DEFAULT/);
  assert.match(calls[1].url, /transfer-key=OVERRIDE/);
});

test('accessToken is sent as Bearer and beats transferKey', async () => {
  const { fetch, calls } = mock(() => json({}));
  const a = new Apirone({ fetch, transferKey: 'K' });
  await a.invoices.list('apr-1', {}, { accessToken: 'TOK' });
  assert.equal(calls[0].headers.authorization, 'Bearer TOK');
  assert.doesNotMatch(calls[0].url, /transfer-key/);
});

test('jwt mode: logs in once, caches, sends Bearer, keeps key out of URL/body', async () => {
  const { fetch, calls } = mock((c) => {
    if (c.url.endsWith('/auth/login')) {
      return json({ login: 'apr-1', 'access-token': jwt(Date.now() / 1000 + 600), 'refresh-token': jwt(Date.now() / 1000 + 86400) });
    }
    return json({ items: [], pagination: {} });
  });
  const a = new Apirone({ fetch, authMode: 'jwt', transferKey: 'SECRET' });
  await a.invoices.list('apr-1');
  await a.invoices.list('apr-1');
  const logins = calls.filter((c) => c.url.endsWith('/auth/login'));
  assert.equal(logins.length, 1);
  assert.deepEqual(logins[0].body, { login: 'apr-1', password: 'SECRET' });
  const lists = calls.filter((c) => c.url.includes('/invoices'));
  assert.equal(lists.length, 2);
  for (const l of lists) {
    assert.match(l.headers.authorization, /^Bearer /);
    assert.doesNotMatch(l.url, /SECRET/);
  }
});

test('jwt mode: expired access token uses refresh-token endpoint', async () => {
  const store = new MemoryTokenStore();
  await store.set('apr-1', { access: 'old', refresh: 'REFRESH', accessExpMs: Date.now() - 1000 });
  const { fetch, calls } = mock((c) => {
    if (c.url.endsWith('/auth/refresh-token')) {
      return json({ login: 'apr-1', 'access-token': jwt(Date.now() / 1000 + 600), 'refresh-token': 'R2' });
    }
    return json({});
  });
  const a = new Apirone({ fetch, authMode: 'jwt', transferKey: 'K', tokenStore: store });
  await a.invoices.list('apr-1');
  assert.ok(calls[0].url.endsWith('/auth/refresh-token'));
  assert.equal(calls[0].headers.authorization, 'Bearer REFRESH');
});

test('jwt mode: a 401 with a stale cached token triggers one re-login and retry', async () => {
  const store = new MemoryTokenStore();
  await store.set('apr-1', { access: 'revoked', refresh: 'r', accessExpMs: Date.now() + 600_000 });
  let listCalls = 0;
  const { fetch, calls } = mock((c) => {
    if (c.url.endsWith('/auth/login')) {
      return json({ login: 'apr-1', 'access-token': 'fresh', 'refresh-token': 'r2' });
    }
    listCalls++;
    return listCalls === 1 ? json({ message: 'nope' }, 401) : json({ items: [] });
  });
  const a = new Apirone({ fetch, authMode: 'jwt', transferKey: 'K', tokenStore: store });
  await a.invoices.list('apr-1');
  assert.equal(listCalls, 2);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer fresh');
});

test('errors carry status/body and never leak the transfer key', async () => {
  const { fetch } = mock(() => json({ message: 'bad key' }, 401));
  const a = new Apirone({ fetch, transferKey: 'TOPSECRET' });
  await assert.rejects(a.wallets.callbackInfo('btc-1'), (e) => {
    assert.ok(e instanceof ApironeError);
    assert.equal(e.status, 401);
    assert.equal(e.isUnauthorized, true);
    assert.deepEqual(e.body, { message: 'bad key' });
    assert.doesNotMatch(e.message + e.url, /TOPSECRET/);
    assert.match(e.url, /transfer-key=\[redacted\]/);
    return true;
  });
});

test('GET retries on 503 then succeeds; POST is never retried', async () => {
  let n = 0;
  const g = mock(() => (++n < 3 ? json({}, 503) : json({ ok: true })));
  const a = new Apirone({ fetch: g.fetch, maxRetries: 3 });
  assert.deepEqual(await a.network.fee('btc'), { ok: true });
  assert.equal(g.calls.length, 3);

  const p = mock(() => json({}, 503));
  const b = new Apirone({ fetch: p.fetch, maxRetries: 3 });
  await assert.rejects(b.accounts.create({ email: 'a@b.c' }), (e) => e.status === 503);
  assert.equal(p.calls.length, 1);
});

test('network failures and timeouts become ApironeError(status 0)', async () => {
  const a = new Apirone({ fetch: async () => { throw new TypeError('boom'); }, maxRetries: 0 });
  await assert.rejects(a.network.fee('btc'), (e) => e instanceof ApironeError && e.status === 0 && e.code === 'network');

  const slow = new Apirone({
    maxRetries: 0,
    timeoutMs: 20,
    fetch: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))),
  });
  await assert.rejects(slow.network.fee('btc'), (e) => e.code === 'timeout');
});

test('service info uses OPTIONS; forwarding keeps callback last and unencoded', async () => {
  const { fetch, calls } = mock(() => json({}));
  const a = new Apirone({ fetch });
  await a.service.info('wallets');
  assert.equal(calls[0].method, 'OPTIONS');
  assert.equal(calls[0].url, 'https://apirone.com/api/v2/wallets');

  await a.forwarding.create({ address: 'bc1qxyz', currency: 'btc', callback: 'https://ex.com/cb?order=7&secret=s' });
  assert.equal(
    calls[1].url,
    'https://apirone.com/api/v1/receive?method=create&address=bc1qxyz&currency=btc&callback=https://ex.com/cb?order=7&secret=s',
  );
  assert.throws(() => a.forwarding.create({ address: 'x', callback: 'ftp://nope' }), TypeError);
});

test('invoice create sends documented field names', async () => {
  const { fetch, calls } = mock(() => json({ invoice: 'i1', status: 'created' }));
  await new Apirone({ fetch }).invoices.create('apr-1', {
    currency: 'btc', amount: '555000', lifetime: 3600,
    'callback-url': 'https://ex.com/hook', 'user-data': { title: 'T' }, linkback: 'https://ex.com/thanks',
  });
  assert.equal(calls[0].url, 'https://apirone.com/api/v2/accounts/apr-1/invoices');
  assert.equal(calls[0].body['callback-url'], 'https://ex.com/hook');
  assert.equal(calls[0].body.amount, '555000');
});

test('estimate formats destinations as addr:amount pairs', async () => {
  const { fetch, calls } = mock(() => json({}));
  await new Apirone({ fetch }).accounts.estimate('apr-1', {
    currency: 'btc',
    destinations: [{ address: 'A', amount: 10000 }, { address: 'B', amount: '50%' }],
    'subtract-fee-from-amount': true,
    addresses: ['X', 'Y'],
  });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('destinations'), 'A:10000,B:50%');
  assert.equal(u.searchParams.get('subtract-fee-from-amount'), 'true');
  assert.equal(u.searchParams.get('addresses'), 'X,Y');
});

test('default fetch is called unbound (workerd "Illegal invocation" guard)', async () => {
  const original = globalThis.fetch;
  let receivedThis = 'unset';
  globalThis.fetch = function () { receivedThis = this; return Promise.resolve(json({})); };
  try {
    await new Apirone().network.fee('btc');
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(receivedThis === undefined || receivedThis === globalThis);
});
