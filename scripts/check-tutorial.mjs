#!/usr/bin/env node
// Runs the code in docs/tutorial.md against the provider's package, and checks that it validates
// cleanly and produces the records of examples/01-one-message, byte for byte.
//
//   node scripts/check-tutorial.mjs <path to a harness-skeleton checkout>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (!process.argv[2]) {
  console.error('usage: node scripts/check-tutorial.mjs <path to a harness-skeleton checkout>');
  process.exit(2);
}
const hs = resolve(process.argv[2]);
const md = readFileSync('docs/tutorial.md', 'utf8').replace(/\r\n/g, '\n');
const blocks = [...md.matchAll(/```(?:js|javascript)\n([\s\S]*?)```/g)].map((m) => m[1]);
if (!blocks.length) { console.error('tutorial: no code blocks found'); process.exit(1); }

// The tutorial's code uses `session` and `m` for the two records it builds. Import declarations
// may stay where they are: ES modules hoist them.
const dir = mkdtempSync(join(tmpdir(), 'tutorial-'));
const out = join(dir, 'out.jsonl');
writeFileSync(join(dir, 'run.mjs'), [
  blocks.join('\n').replaceAll('<harness-skeleton>', hs),
  "import { writeFileSync as __w } from 'node:fs';",
  `__w(${JSON.stringify(out)}, JSON.stringify(session) + '\\n' + JSON.stringify(m) + '\\n');`,
].join('\n'));

try {
  const printed = execFileSync(process.execPath, [join(dir, 'run.mjs')], { encoding: 'utf8' });
  process.stdout.write(printed);
  const valid = printed.split('\n').some((l) => l.trim() === '[]');
  const same = readFileSync(out, 'utf8') === readFileSync('examples/01-one-message/session.jsonl', 'utf8');
  if (!valid) console.log('tutorial: validateSession did not print []');
  console.log(same ? 'tutorial: matches examples/01-one-message' : 'tutorial: output differs from examples/01-one-message');
  process.exitCode = valid && same ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
