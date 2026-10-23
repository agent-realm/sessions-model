// Generates examples/ from synthetic records, seals each record with the
// session-adapters package's own seal() (cmp_sha, content_sha), and validates every file with
// the package's validateSession(). Prints findings; exits non-zero on any.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = process.argv[2];   // .../packages/session-adapters (exported from a known commit)
const OUT = process.argv[3];   // the examples/ directory
const { seal } = await import(join(PKG, 'src/records.js'));
const { validateSession } = await import(join(PKG, 'src/validate.js'));

// The contract's own known-answer host: sha256("sessions-model/host/v0:" +
// "0f1e2d3c4b5a69788796a5b4c3d2e1f0")[:32], a synthetic Linux machine id.
const HOST = '0d0d3eefb2fba3434590abdc952a7ef7';

function store(harness, harness_path) { return { host: HOST, harness, harness_path }; }
function key(st, session_id, incarnation = '') { return { ...st, session_id, incarnation }; }

function session(k, extra) {
  return {
    type: 'session', ...k, engine: null, client: k.harness, harness_version: '1.0.0',
    title: null, title_set_by: null, cwd: '/home/user/demo', last_cwd: '/home/user/demo',
    created_at: '2026-01-05T10:00:00.000Z', updated_at: '2026-01-05T10:00:00.000Z',
    state: 'active', pinned: null, mode: null, kind: null, reuse: 'impossible',
    ts_source: 'event', aliases: [], setup: null, fingerprint: { cmp_shas: [] }, ...extra,
  };
}
let seq = 0;
function message(k, id, role, parts, extra = {}) {
  const ts = extra.ts ?? `2026-01-05T10:00:${String(10 + seq).padStart(2, '0')}.000Z`;
  const order = `${ts}|${k.source_key ?? 'main'}|${String(seq++).padStart(6, '0')}`;
  const { source_key: _s, ...kk } = k;
  return {
    type: 'message', ...kk, message_id: id, parent_id: extra.parent_id ?? null, order, agent_id: '',
    to_user: null, to_model: null, status: 'complete', state: 'current', on_active_branch: null, ts,
    requested_model: null, served_model: role === 'assistant' ? 'model-a' : null, effort: null,
    response_id: extra.response_id ?? null, aliases: [], role,
    source: role === 'user' ? 'user' : role === 'assistant' ? 'model' : null, parts, ...extra,
  };
}
const text = (part_id, t) => ({ part_id, kind: 'text', text: t });

// Seal messages first, then the session with the fingerprint of its messages, in order.
function finish(k, sessionExtra, others) {
  const sealed = others.map(seal);
  const shas = sealed.filter((r) => r.type === 'message').map((r) => r.cmp_sha);
  const s = seal(session(k, { ...sessionExtra, fingerprint: { cmp_shas: shas } }));
  return [s, ...sealed];
}

function write(dir, file, records, expect) {
  mkdirSync(join(OUT, dir), { recursive: true });
  writeFileSync(join(OUT, dir, file), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const findings = validateSession(records, expect);
  console.log(`${dir}/${file}: ${records.length} records, ${findings.length} findings`);
  for (const f of findings) console.log(`  ${f.at}: ${f.problem}`);
  return findings.length;
}

let bad = 0;
const CC = store('claude-code', '/home/user/.claude');
const GEM = store('gemini-cli', '/home/user/.gemini');
// Links, a destructive rewind and a compaction are shown on the reference harness, whose native
// store records each of them explicitly; the annex does not record them for Claude Code.
const RH = store('reference-harness', '/home/user/.reference-harness');

// 01 — one session, one message.
{
  const k = key(CC, '11111111-1111-4111-8111-111111111111');
  seq = 0;
  bad += write('01-one-message', 'session.jsonl', finish(k, { title: 'hello' }, [
    message(k, 'm-0001', 'user', [text('0', 'Hello.')]),
  ]), { harness: 'claude-code', sessionId: k.session_id });
}

// 02 — parts and a tool call: reasoning, tool_call, tool_result with exit_code, final text.
{
  const k = key(CC, '22222222-2222-4222-8222-222222222222');
  seq = 0;
  bad += write('02-parts-and-tools', 'session.jsonl', finish(k, { title: 'run the tests' }, [
    message(k, 'm-0001', 'user', [text('0', 'Run the tests.')]),
    message(k, 'm-0002', 'assistant', [
      { part_id: '0', kind: 'reasoning', text: 'Run the suite first.' },
      { part_id: '1', kind: 'tool_call', call_id: 'call-1', name: 'shell', args: { command: 'npm test' }, server: null },
    ], { parent_id: 'm-0001', response_id: 'resp-1' }),
    message(k, 'm-0003', 'tool', [
      { part_id: '0', kind: 'tool_result', call_id: 'call-1', is_error: false, status: 'completed', output: '12 passing', output_len: 10, truncated: null, exit_code: 0 },
    ], { parent_id: 'm-0002' }),
    message(k, 'm-0004', 'assistant', [text('0', 'All 12 tests pass.')], { parent_id: 'm-0003', response_id: 'resp-2' }),
  ]), { harness: 'claude-code', sessionId: k.session_id });
}

// 03 — usage with the two flags: one harness per file, as each vendor reports it.
{
  const k = key(CC, '33333333-3333-4333-8333-333333333333');
  seq = 0;
  const usage = (id, resp, n) => ({
    type: 'usage', ...k, usage_id: id, anchor: { response_id: resp }, input: n.input, output: n.output,
    cache_read: n.cache_read, cache_write: n.cache_write, reasoning: null, tool_prompt: null, cost: null,
    input_includes_cache: false, output_includes_reasoning: true, granularity: 'per_response', model: 'model-a',
  });
  bad += write('03-usage', 'claude-code.jsonl', finish(k, { title: 'usage, cache beside input' }, [
    message(k, 'm-0001', 'user', [text('0', 'Summarise the README.')]),
    message(k, 'm-0002', 'assistant', [text('0', 'It explains the two contracts.')], { parent_id: 'm-0001', response_id: 'resp-1' }),
    usage('response:resp-1#1', 'resp-1', { input: 12, output: 40, cache_read: 2000, cache_write: 150 }),
  ]), { harness: 'claude-code', sessionId: k.session_id });

  const g = key(GEM, '33333333-3333-4333-8333-33333333333a');
  seq = 0;
  bad += write('03-usage', 'gemini-cli.jsonl', finish(g, { title: 'usage, cache inside input, tool prompt apart' }, [
    message(g, 'm-0001', 'user', [text('0', 'List the files.')]),
    message(g, 'm-0002', 'assistant', [text('0', 'Three files.')], { parent_id: 'm-0001', response_id: 'resp-1', served_model: 'model-b' }),
    { type: 'usage', ...g, usage_id: 'response:resp-1#1', anchor: { response_id: 'resp-1' }, input: 900, output: 30,
      cache_read: 600, cache_write: null, reasoning: 25, tool_prompt: 80, cost: null,
      input_includes_cache: true, output_includes_reasoning: false, granularity: 'per_response', model: 'model-b' },
  ]), { harness: 'gemini-cli', sessionId: g.session_id });
}

// 04 — links: a fork stated on the child, and a sub-agent stated on its origin (the spawning call).
{
  const origin = { harness: 'reference-harness', session_id: '44444444-4444-4444-8444-444444444440' };
  const k = key(RH, '44444444-4444-4444-8444-444444444441');
  seq = 0;
  bad += write('04-links', 'fork-child.jsonl', finish(k, { title: 'fork of an earlier session' }, [
    message(k, 'm-0001', 'user', [text('0', 'Try the other approach.')]),
    { type: 'link', ...k, kind: 'fork', stated_on: 'child',
      child: { harness: 'reference-harness', session_id: k.session_id, incarnation: '' }, origin,
      at: 'm-0007', inherits: { through_message_id: 'm-0007', ids_preserved: true, marked: true, usage_copied: false },
      child_stored: true, evidence: 'explicit' },
  ]), { harness: 'reference-harness', sessionId: k.session_id });

  const p = key(RH, '44444444-4444-4444-8444-444444444442');
  seq = 0;
  bad += write('04-links', 'subagent-parent.jsonl', finish(p, { title: 'parent that starts a sub-agent' }, [
    message(p, 'm-0001', 'user', [text('0', 'Review the change.')]),
    message(p, 'm-0002', 'assistant', [
      { part_id: '0', kind: 'tool_call', call_id: 'call-9', name: 'spawn_agent', args: { task: 'review' }, server: null },
    ], { parent_id: 'm-0001', response_id: 'resp-1' }),
    { type: 'link', ...p, kind: 'subagent', stated_on: 'origin',
      child: { harness: 'reference-harness', session_id: '44444444-4444-4444-8444-444444444443' },
      origin: { harness: 'reference-harness', session_id: p.session_id, incarnation: '' },
      at: 'call-9', inherits: null, child_stored: true, evidence: 'explicit' },
  ]), { harness: 'reference-harness', sessionId: p.session_id });
}

// 05 — lifecycle: a retraction (append-only) and a destructive rewind (the store rewrote itself).
{
  const g = key(GEM, '55555555-5555-4555-8555-555555555551');
  seq = 0;
  bad += write('05-lifecycle', 'retraction.jsonl', finish(g, { title: 'rewind by retraction' }, [
    message(g, 'm-0001', 'user', [text('0', 'Rename the module.')]),
    message(g, 'm-0002', 'assistant', [text('0', 'Renamed it to core.')], { parent_id: 'm-0001', response_id: 'resp-1', state: 'retracted' }),
    message(g, 'm-0003', 'user', [text('0', 'Rename it to base instead.')], { parent_id: 'm-0001' }),
    { type: 'lifecycle', ...g, lifecycle_id: 'rewind-1', op: 'rewind', target: { message_id: 'm-0002' },
      at: 'm-0001', ts: '2026-01-05T10:00:40.000Z', evidence: 'explicit' },
  ]), { harness: 'gemini-cli', sessionId: g.session_id });

  const k = key(RH, '55555555-5555-4555-8555-555555555552');
  seq = 0;
  bad += write('05-lifecycle', 'destructive.jsonl', finish(k, { title: 'rewind that rewrote the store' }, [
    message(k, 'm-0001', 'user', [text('0', 'Rename the module.')]),
    message(k, 'm-0004', 'user', [text('0', 'Rename it to base instead.')], { parent_id: 'm-0001' }),
    { type: 'lifecycle', ...k, lifecycle_id: 'rewind-1', op: 'rewind',
      target: { range: { from_id: 'm-0002', through_id: 'm-0003' } }, at: 'm-0001',
      ts: '2026-01-05T10:00:40.000Z', evidence: 'explicit' },
  ]), { harness: 'reference-harness', sessionId: k.session_id });
}

// 06 — a full session: title, reasoning, a tool round, an error, compaction, usage.
{
  const k = key(RH, '66666666-6666-4666-8666-666666666666');
  seq = 0;
  const u = (id, resp, n) => ({
    type: 'usage', ...k, usage_id: id, anchor: { response_id: resp }, ...n, reasoning: null, tool_prompt: null,
    cost: null, input_includes_cache: false, output_includes_reasoning: true, granularity: 'per_response', model: 'model-a',
  });
  bad += write('06-full-session', 'session.jsonl', finish(k, {
    title: 'fix the failing test', title_set_by: 'auto', updated_at: '2026-01-05T10:01:30.000Z', harness_version: '1.0.0',
  }, [
    message(k, 'm-0001', 'user', [text('0', 'The date test fails. Fix it.')]),
    message(k, 'm-0002', 'assistant', [
      { part_id: '0', kind: 'reasoning', text: 'Read the test first.' },
      { part_id: '1', kind: 'tool_call', call_id: 'call-1', name: 'read_file', args: { path: 'test/date.test.js' }, server: null },
    ], { parent_id: 'm-0001', response_id: 'resp-1' }),
    message(k, 'm-0003', 'tool', [
      { part_id: '0', kind: 'tool_result', call_id: 'call-1', is_error: false, status: 'completed', output: 'expect(fmt(d)).toBe("2026-01-05")', output_len: 34, truncated: null, exit_code: null },
    ], { parent_id: 'm-0002' }),
    message(k, 'm-0004', 'assistant', [
      { part_id: '0', kind: 'tool_call', call_id: 'call-2', name: 'shell', args: { command: 'npm test' }, server: null },
    ], { parent_id: 'm-0003', response_id: 'resp-2' }),
    message(k, 'm-0005', 'tool', [
      { part_id: '0', kind: 'tool_result', call_id: 'call-2', is_error: true, status: 'completed', output: '1 failing', output_len: 9, truncated: null, exit_code: 1 },
    ], { parent_id: 'm-0004' }),
    message(k, 'm-0006', 'assistant', [
      { part_id: '0', kind: 'error', error_kind: 'rate_limit', message: 'Too many requests; retried.', http_status: 429 },
      { part_id: '1', kind: 'text', text: 'The formatter used local time. Fixed it to UTC; the test passes.' },
    ], { parent_id: 'm-0005', response_id: 'resp-3' }),
    message(k, 'm-0007', 'system', [
      { part_id: '0', kind: 'summary', text: 'Fixed the date formatter to UTC; tests pass.', replaces: { through_id: 'm-0006' } },
    ], { parent_id: 'm-0006', source: null }),
    u('response:resp-1#1', 'resp-1', { input: 20, output: 35, cache_read: 1800, cache_write: 200 }),
    u('response:resp-2#1', 'resp-2', { input: 15, output: 12, cache_read: 2050, cache_write: 0 }),
    u('response:resp-3#1', 'resp-3', { input: 30, output: 60, cache_read: 2100, cache_write: 0 }),
    { type: 'lifecycle', ...k, lifecycle_id: 'compaction-1', op: 'compaction', target: { session: true },
      at: 'm-0007', ts: '2026-01-05T10:01:30.000Z', evidence: 'explicit' },
  ]), { harness: 'reference-harness', sessionId: k.session_id });
}

console.log(bad === 0 ? 'ALL VALID' : `${bad} findings`);
process.exit(bad === 0 ? 0 : 1);
