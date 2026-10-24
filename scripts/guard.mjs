#!/usr/bin/env node
// The publication guard: every tracked file, and the commits of a change, are checked for
// content that does not belong in a public repo. It prints where a hit is (file and line, or
// commit), never the matched text.
//
//   node scripts/guard.mjs                     scan the tracked files
//   node scripts/guard.mjs --commits A..B      also scan the commits in A..B (messages, authors, dates)
//
// Checks:
//   - generic classes: credential shapes, home paths with a user name, private IP addresses,
//     e-mail addresses other than noreply and example ones, machine numbers;
//   - process wording that belongs in no contract (relay tags, operator quotes, and the like);
//   - names that must not appear, held only as hashes in scripts/guard-names.sha256, so the list
//     reveals nothing (tokens and two-token phrases, lowercased; see tokens() below);
//   - structure: every contract's H1 carries its version.
//
// A false positive goes into ALLOW below (per check, a line pattern). Never reword correct text
// to pass the guard.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAINTAINER = '3527695+ramazanpolat@users.noreply.github.com';

const CHECKS = {
  'credential shape': /ghp_[A-Za-z0-9]{20}|github_pat_|\bsk-[A-Za-z0-9]{16}|sk-ant-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[abp]-[0-9]|(password|passwd|token|api_key|secret)\s*[=:]\s*["']?[A-Za-z0-9/+_-]{12}|:\/\/[^\/\s:@]+:[^\/\s@]+@/i,
  'home path with a user name': /\/Users\/(?!user\b|me\b|you\b)[A-Za-z]|\/home\/(?!user\b|me\b|you\b)[a-z]+/,
  'private IP address': /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/,
  'e-mail address': /[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com\b|anthropic\.com\b|github\.com\b|example\.(com|org|net)\b)[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/,
  'machine number': /\b(VM|CT|LXC)\s+\d+\b/,
  'process wording': /(?<![Cc]o)(?<![Aa]uto)\b[Pp]ilot\b|\[via [^\]]+\]|\brelayed (via|by)\b|\bfirst-hand\b|\bcanon(?!ical)|\bumbrella\b|\bconstellation\b|\bsync plan\b|\bround-1\b|\bpublic cut\b|\bsynced from\b|\bChanges from v0\b|\blab capture|\bSCOPE\.md\b|misc\/fixtures|packages\/reference-harness|\blab#\d|\bTier [0-9]\b/,
};

const ALLOW = {
  // 'check name': [/line pattern that is correct text/],
};

const NAMES = new Set(
  readFileSync(new URL('./guard-names.sha256', import.meta.url), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f]{16}$/.test(l)),
);

const h = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

// Lowercased tokens, the parts of each token split on / @ . -, and two-token phrases.
export function tokens(line) {
  const whole = (line.toLowerCase().match(/[a-z0-9][a-z0-9._@\/+-]*/g) || [])
    .map((t) => t.replace(/[._\/+-]+$/, '')).filter(Boolean);
  const out = new Set(whole);
  for (const t of whole) {
    for (const p of t.split(/[\/@.-]+/)) if (p) out.add(p);
    const seg = t.split('/').filter(Boolean);                // path segments, and each adjacent pair
    seg.forEach((x, i) => { out.add(x); if (i + 1 < seg.length) out.add(`${x}/${seg[i + 1]}`); });
  }
  for (let i = 0; i + 1 < whole.length; i++) out.add(`${whole[i]} ${whole[i + 1]}`);
  return out;
}

function checkLine(line) {
  const hits = [];
  for (const [name, rx] of Object.entries(CHECKS)) {
    if (rx.test(line) && !(ALLOW[name] || []).some((a) => a.test(line))) hits.push(name);
  }
  for (const t of tokens(line)) if (NAMES.has(h(t))) { hits.push('listed name'); break; }
  return hits;
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const report = [];

// 1. Tracked files.
for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (f === 'scripts/guard-names.sha256' || f === 'scripts/guard.mjs') continue;   // the list, and the patterns themselves
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;                       // binary
  text.split('\n').forEach((line, i) => {
    for (const hit of checkLine(line)) report.push(`${f}:${i + 1}: ${hit}`);
  });
  if (/^contracts\/[^/]+\.md$/.test(f) && !/^# .* v\d+(\.\d+)*\b/.test(text.split('\n', 1)[0])) {
    report.push(`${f}:1: contract H1 carries no version`);
  }
}

// 2. Commits, when a range is given.
const at = process.argv.indexOf('--commits');
if (at > 0 && process.argv[at + 1]) {
  const range = process.argv[at + 1];
  const log = git('log', '--format=%H%x1f%ae%x1f%ce%x1f%ad%x1f%cd%x1f%B%x1e', '--date=format:%z', range);
  for (const rec of log.split('\x1e').map((r) => r.trim()).filter(Boolean)) {
    const [sha, ae, ce, az, cz, body] = rec.split('\x1f');
    const c = sha.slice(0, 7);
    for (const e of [ae, ce]) if (NAMES.has(h(e.toLowerCase()))) report.push(`commit ${c}: listed author or committer address`);
    if (ae === MAINTAINER && az !== '+0000') report.push(`commit ${c}: author date not in UTC`);
    if (ce === MAINTAINER && cz !== '+0000') report.push(`commit ${c}: committer date not in UTC`);
    body.split('\n').forEach((line, i) => {
      for (const hit of checkLine(line)) report.push(`commit ${c}, message line ${i + 1}: ${hit}`);
    });
  }
}

for (const r of report) console.log(r);
console.log(report.length ? `guard: ${report.length} hit(s)` : 'guard: clean');
process.exit(report.length ? 1 : 0);
