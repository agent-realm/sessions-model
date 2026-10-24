#!/usr/bin/env node
// Runs the code in docs/tutorial.md against the provider's package and checks that it produces
// the records of examples/01-one-message, byte for byte.
//
//   node scripts/check-tutorial.mjs <path to harness-skeleton checkout>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const hs = resolve(process.argv[2] || '');
const md = readFileSync('docs/tutorial.md', 'utf8');
const code = [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n').replaceAll('<harness-skeleton>', hs);
const lines = code.split('\n');
const imports = lines.filter((l) => l.startsWith('import '));
const rest = lines.filter((l) => !l.startsWith('import '));

const dir = mkdtempSync(join(tmpdir(), 'tutorial-'));
const out = join(dir, 'out.jsonl');
writeFileSync(join(dir, 'run.mjs'), [
  ...imports, "import { writeFileSync as __w } from 'node:fs';", ...rest,
  `__w(${JSON.stringify(out)}, JSON.stringify(session) + '\\n' + JSON.stringify(m) + '\\n');`,
].join('\n'));

try {
  const printed = execFileSync('node', [join(dir, 'run.mjs')], { encoding: 'utf8' });
  process.stdout.write(printed);
  const same = readFileSync(out, 'utf8') === readFileSync('examples/01-one-message/session.jsonl', 'utf8');
  console.log(same ? 'tutorial: matches examples/01-one-message' : 'tutorial: output differs from examples/01-one-message');
  process.exitCode = same ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
