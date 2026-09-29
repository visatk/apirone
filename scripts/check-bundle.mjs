// Fails if anything reachable from the workerd entry imports a Node built-in.
// That is what would force consumers to enable nodejs_compat.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const BUILTIN = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:node:[^'"]+|fs|path|crypto|buffer|stream|http|https|net|os|util|zlib|child_process)['"]/;

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(root);

let bad = 0;
for (const f of files) {
  if (f.endsWith('/entries/node.js')) continue; // node entry is allowed to (currently doesn't) use built-ins
  if (BUILTIN.test(readFileSync(f, 'utf8'))) { console.error('Node built-in import in', f); bad++; }
}
if (bad) process.exit(1);
console.log(`ok: ${files.length} files checked, no Node built-ins reachable from the workerd entry`);
