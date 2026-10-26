#!/usr/bin/env node
// The publication guard. It checks the tracked files (paths and contents), and the commits of a
// change, for content that does not belong in a public repo, and prints where a hit is (file and
// line, or commit), never the matched text.
//
//   node scripts/guard.mjs                       scan the tracked files
//   node scripts/guard.mjs --commits <range>     also scan those commits: author and committer
//                                                names, messages, and every path they touch and
//                                                line they add; addresses only against --names
//                                                (<range> is A..B, or one ref for its whole history)
//   node scripts/guard.mjs --names <file>        also look for the names in a local file
//   node scripts/guard.mjs --self-test           run the guard's own cases (SELF_TEST below)
//
// The --names file holds one name per line (a word, or a phrase of up to three words; any
// punctuation between words is equivalent), or a line `re:<regex>`; `#` starts a comment, at the
// start of a line or after a space. It never enters this repo in any form, plain or hashed: hashes of short names can be
// reversed. The maintainer runs it before every push.
//
// A false positive in a pattern check goes into ALLOW (per check, a line pattern), in a pull
// request of its own: CI runs the base branch's copy of this file. Never reword correct text to
// pass the guard.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Each check returns true when the line has a hit.
const CHECKS = {
  'credential shape': (l) =>
    /gh[opusr]_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}|\bsk-[A-Za-z0-9-]{16}|sk-ant-[A-Za-z0-9-]{8}|sk_live_[A-Za-z0-9]{16}|glpat-[A-Za-z0-9_-]{16}|AIza[0-9A-Za-z_-]{30}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abpr]-[0-9]|:\/\/[^\/\s:@]+:[^\/\s@]+@|\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./.test(l) ||
    /\bbearer\s+[A-Za-z0-9._~+\/-]{16}/i.test(l) ||
    [...l.matchAll(/(password|passwd|token|api[_-]?key|secret)["']?\s*[=:]\s*["']?([A-Za-z0-9\/+_.-]{12,})/gi)]
      .some((m) => /\d/.test(m[2]) && /[A-Za-z]/.test(m[2])),
  'home path with a user name': (l) => {
    // A path inside a web URL (http, https, ws, wss) with a host is not a home path: it names a
    // resource on a server. Only the URL token itself is set aside, so a home path elsewhere on the
    // line (the next JSON value, say) is still checked. Every other scheme stays checked: ssh://,
    // git+ssh://, rsync:// and file:// paths are paths on a real machine.
    const rest = l.replace(/\b(https?|wss?):\/\/[^\s\/"'<>()\[\]{},|`^][^\s"'<>()\[\]{},|`^]*/gi, ' ');
    return /\/(Users|users|home)\/(?!user\b|me\b|you\b|runner\b)[A-Za-z0-9_]/.test(rest) ||
      /[A-Za-z]:\\+Users\\+(?!user\b|public\b)[A-Za-z0-9_]/i.test(rest);
  },
  'private IP address': (l) =>
    /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/.test(l) ||
    /\b(f[cd][0-9a-f]{2}|fe80):[0-9a-f:]*:[0-9a-f]{1,4}\b/i.test(l),
  'e-mail address': (l) =>
    (l.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g) || []).some((e) => !EMAIL_OK.test(e)),
  'machine number': (l) => /\b(VM|CT|LXC|VMID|VM ID)[\s#:=_-]*\d{2,}\b/i.test(l),
  'process wording': (l) =>
    /\bpilot\b|\[via [^\]]+\]|\brelayed (via|by)\b|\bfirst-hand\b|\bcanon(?!ical)|\bumbrella\b|\bconstellation\b/i.test(l),
};
// noreply addresses and example domains.
const EMAIL_OK = /^([0-9]+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$|^noreply@(github|anthropic)\.com$|@example\.(com|org|net)$/;

const ALLOW = {
  'process wording': [/^\s*\/\\bpilot\\b\|\\\x5bvia /],   // the pattern above, in this file
};

// Cases for --self-test: [line, check, expected]. Paths are split so this file stays clean.
const H = '/ho' + 'me/', U = '/Us' + 'ers/', AT = '@';
const SELF_TEST = [
  ['{"url":"https://example.com","cwd":"' + H + 'alice/project"}', 'home path with a user name', true],
  ['{"url":"https://example.com' + H + 'alice/project"}', 'home path with a user name', false],
  ['see https://api.github.com/users/octocat', 'home path with a user name', false],
  ['/mnt/c' + U + 'bob/x', 'home path with a user name', true],
  ['file://' + U + 'bob/x', 'home path with a user name', true],
  [H + 'user/project', 'home path with a user name', false],
  ['DOCKER_HOST=unix://' + U + 'bob/.orbstack/run/docker.sock', 'home path with a user name', true],
  ['git+file://' + H + 'bob/repo', 'home path with a user name', true],
  ['FILE://' + U + 'bob/x', 'home path with a user name', true],
  ['C:/' + U + 'bob/x', 'home path with a user name', true],
  ['|https://example.com|' + H + 'alice|', 'home path with a user name', true],
  ['`https://example.com`' + H + 'alice', 'home path with a user name', true],
  ['ssh://host' + H + 'alice', 'home path with a user name', true],
  ['git+ssh://git' + AT + 'bench' + H + 'alice/repo.git', 'home path with a user name', true],
  ['rsync://bench' + H + 'alice/data', 'home path with a user name', true],
  ['wss://example.com' + H + 'alice/socket', 'home path with a user name', false],
  ['sessions-model@v1.1', 'e-mail address', false],
];

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  if (args.length > 1) { console.error('guard: --self-test takes no other arguments'); process.exit(2); }
  let failed = 0;
  SELF_TEST.forEach(([line, check, want], i) => {
    if (CHECKS[check](line) !== want) { failed++; console.log(`self-test: case ${i + 1} (${check}) expected ${want ? 'a hit' : 'no hit'}`); }
  });
  console.log(failed ? `guard self-test: ${failed} failed` : `guard self-test: ${SELF_TEST.length} passed`);
  process.exit(failed ? 1 : 0);
}
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--commits' && args[i] !== '--names') { console.error(`guard: unknown argument ${args[i]}`); process.exit(2); }
  if (!args[i + 1] || args[i + 1].startsWith('--')) { console.error(`guard: ${args[i]} needs a value`); process.exit(2); }
  opts[args[i]] = args[++i];
}
const range = opts['--commits'];

// Words: letters and digits of any script, NFC, lowercased, plus an ASCII-folded form.
const fold = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
const norm = (s) => s.normalize('NFC').toLocaleLowerCase('tr').replace(/i̇/g, 'i');
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const key = (s) => (norm(s).match(WORD) || []).join('-');

const NAMES = new Set();
const NAME_RX = [];
if (opts['--names']) {
  readFileSync(opts['--names'], 'utf8').split('\n').forEach((raw, n) => {
    const l = raw.replace(/\s+#.*$/, '').trim();
    if (!l || l.startsWith('#')) return;
    if (l.startsWith('re:')) {
      try { NAME_RX.push(new RegExp(l.slice(3), 'iu')); }
      catch { console.error(`guard: names file line ${n + 1}: not a valid regex`); process.exit(2); }
      return;
    }
    const k = key(l);
    NAMES.add(k); NAMES.add(fold(k));
    if (l.includes('/') || l.includes('@')) { NAMES.add(norm(l)); NAMES.add(fold(norm(l))); }
  });
}

// Candidates: each whole token (with its / @ . kept), path segments without .git and adjacent
// segment pairs, and every run of one to three words across the line (words split on anything that
// is not a letter, mark or digit), joined by a hyphen; each also in its ASCII-folded form. So a name
// matches inside a longer token, an address, a path or a hostname.
function candidates(line) {
  const n = norm(line);
  const out = new Set();
  for (const t of (n.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}._@\/+-]*/gu) || []).map((x) => x.replace(/[._\/+-]+$/u, ''))) {
    out.add(t);
    const seg = t.split('/').map((x) => x.replace(/\.git$/, '')).filter(Boolean);
    seg.forEach((x, i) => { out.add(x); if (i + 1 < seg.length) out.add(`${x}/${seg[i + 1]}`); });
  }
  const words = n.match(WORD) || [];
  for (let len = 1; len <= 3; len++) for (let i = 0; i + len <= words.length; i++) out.add(words.slice(i, i + len).join('-'));
  for (const c of [...out]) out.add(fold(c));
  return out;
}

const listed = (s) => (NAMES.size && [...candidates(s)].some((x) => NAMES.has(x))) ||
  NAME_RX.some((r) => r.test(s) || r.test(fold(norm(s))));

function checkLine(line) {
  const hits = [];
  for (const [name, test] of Object.entries(CHECKS)) {
    if (test(line) && !(ALLOW[name] || []).some((a) => a.test(line))) hits.push(name);
  }
  if (listed(line)) hits.push('listed name');
  return hits;
}

const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 256 << 20 });
const report = [];

// 1. Tracked files: their paths and their lines.
for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
  for (const hit of checkLine(f)) report.push(`path ${f}: ${hit}`);
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;                       // binary
  text.split(/\r?\n/).forEach((line, i) => {
    for (const hit of checkLine(line)) report.push(`${f}:${i + 1}: ${hit}`);
  });
  if (/^contracts\/[^/]+\.md$/.test(f) && !/^# .* v\d+(\.\d+)*\b/.test(text.split('\n', 1)[0])) {
    report.push(`${f}:1: contract H1 carries no version`);
  }
}

// 2. Commits: who, what they say, and every path and line they add. A line added and removed
//    again inside the range is still published in the range's commits.
if (range) {
  for (const sha of git('rev-list', range).split('\n').filter(Boolean)) {
    const c = sha.slice(0, 7);
    const [an, ae, cn, ce] = git('show', '-s', '--format=%an%n%ae%n%cn%n%ce', sha).split('\n');
    for (const [what, v] of [['author name', an], ['committer name', cn]]) {
      for (const hit of checkLine(v || '')) if (hit !== 'process wording') report.push(`commit ${c}: ${what}: ${hit}`);
    }
    for (const [what, v] of [['author address', ae], ['committer address', ce]]) {
      if (listed(v || '')) report.push(`commit ${c}: ${what}: listed name`);
    }
    git('show', '-s', '--format=%B', sha).split('\n').forEach((line, i) => {
      for (const hit of checkLine(line)) report.push(`commit ${c}, message line ${i + 1}: ${hit}`);
    });
    for (const f of git('show', '--format=', '--name-only', '-z', '--no-renames', '-m', '--first-parent', sha).split('\0').filter(Boolean)) {
      for (const hit of checkLine(f)) report.push(`commit ${c}, path ${f}: ${hit}`);
    }
    // --text and --no-textconv: a .gitattributes cannot hide added lines as binary.
    let file = '', header = false;
    for (const line of git('show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', '--text', '--no-textconv', '-m', '--first-parent', sha).split('\n')) {
      if (line.startsWith('diff --git ')) { header = true; continue; }
      if (line.startsWith('@@')) { header = false; continue; }
      if (header) {
        if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '').replace(/\t$/, '');
        continue;
      }
      if (line.startsWith('+')) for (const hit of checkLine(line.slice(1))) report.push(`commit ${c}, added to ${file}: ${hit}`);
    }
  }
}

for (const r of report) console.log(r);
console.log(report.length ? `guard: ${report.length} hit(s)` : 'guard: clean');
process.exit(report.length ? 1 : 0);
