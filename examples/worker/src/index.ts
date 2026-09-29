import {
  Apirone, ApironeError, KVTokenStore, createCallbackHandler, isInvoiceConfirmed,
} from 'apirone-workerd';

interface Env {
  APIRONE_ACCOUNT: string;
  APIRONE_TRANSFER_KEY: string; // wrangler secret put APIRONE_TRANSFER_KEY
  CALLBACK_SECRET: string;      // wrangler secret put CALLBACK_SECRET
  TOKENS?: KVNamespace;         // optional, only used with authMode: 'jwt'
}

// Build the client per isolate, not per request, so retries/JWT cache are reused.
let client: Apirone | undefined;
function apirone(env: Env): Apirone {
  return (client ??= new Apirone({
    transferKey: env.APIRONE_TRANSFER_KEY,
    ...(env.TOKENS ? { authMode: 'jwt' as const, tokenStore: new KVTokenStore(env.TOKENS) } : {}),
  }));
}

const onCallback = createCallbackHandler<Env>({
  secret: (env) => env?.CALLBACK_SECRET,
  onInvoice: async (cb, { env }) => {
    // Re-fetch the invoice from Apirone rather than trusting the callback body alone.
    const inv = await apirone(env!).invoices.get(cb.invoice);
    if (isInvoiceConfirmed(inv.status)) {
      console.log('fulfil order for invoice', inv.invoice);
    }
  },
  onError: (e) => console.error('callback failed', e),
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/checkout' && request.method === 'POST') {
        const invoice = await apirone(env).invoices.create(env.APIRONE_ACCOUNT, {
          currency: 'usdt@trx',
          amount: '5000000', // 5.00 USDT (6 decimals), as a string
          lifetime: 3600,
          'callback-url': `${url.origin}/apirone/callback?secret=${encodeURIComponent(env.CALLBACK_SECRET)}`,
          'user-data': { title: 'Order #1042', merchant: 'Example Shop' },
        });
        return Response.redirect(invoice['invoice-url'], 303);
      }

      if (url.pathname === '/apirone/callback') {
        return onCallback(request, env, ctx);
      }

      if (url.pathname === '/rate') {
        return Response.json(await apirone(env).ticker.get({ currency: 'btc', fiat: 'usd' }));
      }
    } catch (e) {
      if (e instanceof ApironeError) {
        return Response.json({ error: e.message, status: e.status }, { status: e.status || 502 });
      }
      throw e;
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
