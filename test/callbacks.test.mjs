import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  createCallbackHandler, parseCallback, callbackOk, isInvoiceConfirmed, isInvoicePaidInFull, toBigInt,
} from '../dist/entries/node.js';
import { KVTokenStore, fetcherToFetch } from '../dist/entries/workerd.js';

const post = (body, headers = {}) =>
  new Request('https://w.example/hook', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

test('callbackOk is exactly 200 text/plain "*ok*"', async () => {
  const r = callbackOk();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/plain/);
  assert.equal(await r.text(), '*ok*');
});

test('parses an invoice callback', async () => {
  const cb = await parseCallback(post({ account: 'apr-1', invoice: 'inv1', status: 'completed' }));
  assert.equal(cb.kind, 'invoice');
  assert.equal(cb.status, 'completed');
});

test('rejects an invoice callback with an unknown status', async () => {
  await assert.rejects(parseCallback(post({ account: 'a', invoice: 'i', status: 'hacked' })), TypeError);
});

test('parses a transaction callback (JSON) and keeps wei precise as a string', async () => {
  const cb = await parseCallback(post({
    value: '1000000000000000000', input_address: '0xabc', confirmations: '2',
    input_transaction_hash: '0xhash', data: { id: 'x' }, account: 'apr-1', currency: 'eth',
  }));
  assert.equal(cb.kind, 'transaction');
  assert.equal(cb.value, '1000000000000000000');
  assert.equal(toBigInt(cb.value), 10n ** 18n);
  assert.equal(cb.confirmations, 2);
  assert.deepEqual(cb.data, { id: 'x' });
});

test('small integer values become numbers', async () => {
  const cb = await parseCallback(post({ value: 30000, input_address: 'a', confirmations: 1, input_transaction_hash: 'h' }));
  assert.equal(cb.value, 30000);
});

test('parses a Simple Forwarding v1 GET callback with custom params', async () => {
  const url = 'https://w.example/hook?order=7&secret=s3&value=100000000&input_address=1E2V&confirmations=1'
    + '&transaction_hash=t1&input_transaction_hash=t0&destination_address=1Lis&value_forwarded=99979800';
  const cb = await parseCallback(new Request(url));
  assert.equal(cb.kind, 'forwarding');
  assert.equal(cb.value_forwarded, 99979800);
  assert.equal(cb.raw.order, '7');
});

test('garbage is rejected', async () => {
  await assert.rejects(parseCallback(post({ hello: 'world' })), TypeError);
  await assert.rejects(
    parseCallback(new Request('https://w.example/', { method: 'POST', body: 'not json', headers: { 'content-type': 'text/plain' } })),
    TypeError,
  );
});

test('handler: acks with *ok*, runs the matching callback, sees env', async () => {
  const seen = [];
  const h = createCallbackHandler({
    onInvoice: async (cb, c) => { seen.push([cb.invoice, c.env.NAME]); },
  });
  const res = await h(post({ account: 'a', invoice: 'i1', status: 'paid' }), { NAME: 'env!' });
  assert.equal(await res.text(), '*ok*');
  assert.deepEqual(seen, [['i1', 'env!']]);
});

test('handler: secret required and constant-time compared (query, data, header)', async () => {
  const h = createCallbackHandler({ secret: 's3cret', onTransaction: () => {} });
  const base = { value: 1, input_address: 'a', confirmations: 0, input_transaction_hash: 'h' };

  assert.equal((await h(post(base))).status, 403);
  assert.equal((await h(post({ ...base, data: { secret: 'wrong' } }))).status, 403);
  assert.equal((await h(post({ ...base, data: { secret: 's3cret' } }))).status, 200);
  assert.equal((await h(post(base, { 'x-callback-secret': 's3cret' }))).status, 200);

  const q = new Request('https://w.example/hook?secret=s3cret', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(base),
  });
  assert.equal((await h(q)).status, 200);
});

test('handler: secret resolved from env; missing config fails closed with 500', async () => {
  const base = { value: 1, input_address: 'a', confirmations: 0, input_transaction_hash: 'h' };
  const h = createCallbackHandler({ secret: (env) => env?.S });
  assert.equal((await h(post({ ...base, secret: 'x' }), {})).status, 500);
  assert.equal((await h(post({ ...base, secret: 'x' }), { S: 'x' })).status, 200);
});

test('handler: thrown error -> 500 (so Apirone retries); background mode acks and uses waitUntil', async () => {
  const errs = [];
  const h = createCallbackHandler({
    onInvoice: () => { throw new Error('db down'); },
    onError: (e) => errs.push(e.message),
  });
  const inv = { account: 'a', invoice: 'i', status: 'completed' };
  assert.equal((await h(post(inv))).status, 500);
  assert.deepEqual(errs, ['db down']);

  const pending = [];
  const bg = createCallbackHandler({
    background: true,
    onInvoice: () => { throw new Error('later'); },
    onError: (e) => errs.push(e.message),
  });
  const res = await bg(post(inv), undefined, { waitUntil: (p) => pending.push(p) });
  assert.equal(await res.text(), '*ok*');
  await Promise.all(pending);
  assert.deepEqual(errs, ['db down', 'later']);
});

test('handler: rejects other methods and bad payloads', async () => {
  const h = createCallbackHandler({});
  assert.equal((await h(new Request('https://w.example/', { method: 'PUT' }))).status, 405);
  assert.equal((await h(post({ nope: 1 }))).status, 400);
});

test('invoice status helpers', () => {
  assert.equal(isInvoiceConfirmed('completed'), true);
  assert.equal(isInvoiceConfirmed('paid'), false);
  assert.equal(isInvoicePaidInFull('overpaid'), true);
  assert.equal(isInvoicePaidInFull('partpaid'), false);
});

test('KVTokenStore round-trips and honours the KV 60s minimum TTL', async () => {
  const data = new Map();
  let ttl;
  const kv = {
    get: async (k) => (data.has(k) ? JSON.parse(data.get(k)) : null),
    put: async (k, v, o) => { data.set(k, v); ttl = o?.expirationTtl; },
    delete: async (k) => { data.delete(k); },
  };
  const s = new KVTokenStore(kv);
  await s.set('apr-1', { access: 'a', refresh: 'r', accessExpMs: 1, refreshExpMs: Date.now() + 5_000 });
  assert.equal(ttl, 60);
  assert.equal((await s.get('apr-1')).access, 'a');
  await s.delete('apr-1');
  assert.equal(await s.get('apr-1'), null);
});

test('fetcherToFetch forwards to the fetcher', async () => {
  const f = fetcherToFetch({ fetch: async (u) => new Response(u) });
  assert.equal(await (await f('https://x.test/')).text(), 'https://x.test/');
});

test('conditional exports: "workerd" condition selects the workerd build, default selects node', () => {
  const run = (flags) => spawnSync(
    process.execPath,
    [...flags, '--input-type=module', '-e', "import('apirone-workerd').then(m => console.log(m.runtime, typeof m.KVTokenStore))"],
    { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' },
  );
  const w = run(['--conditions=workerd']);
  assert.equal(w.stdout.trim(), 'workerd function', w.stderr);
  const n = run([]);
  assert.equal(n.stdout.trim(), 'node undefined', n.stderr);
});
