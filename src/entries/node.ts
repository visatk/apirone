// Selected by "node" / "import" / "default". Same portable core (Node >= 18 has fetch and Web Crypto).
export * from '../core/index.js';
export const runtime = 'node' as const;
