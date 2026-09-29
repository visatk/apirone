// Selected by the "workerd" / "worker" export conditions (wrangler, Miniflare, vitest-pool-workers).
// Must never import from node:* so it runs without the nodejs_compat flag.
export * from '../core/index.js';
export * from '../platform/workerd.js';
