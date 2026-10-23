# Tutorial: from a transcript line to a valid record

This walks one line of a harness's transcript through to a sessions-model record that passes the
reference validator. It takes about fifteen minutes and needs Node.js 22 or later. Every value is
synthetic.

## 1. Name the session

Every record carries the session key `(host, harness, harness_path, session_id, incarnation)`
([keys and identity](keys-and-identity.md)).

```js
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

// host: sha256 over "sessions-model/host/v0:" + the machine id, first 32 hex digits.
// This machine id is the contract's own synthetic known-answer input.
const machineId = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const host = createHash('sha256').update('sessions-model/host/v0:' + machineId, 'utf8').digest('hex').slice(0, 32);
console.log(host); // 0d0d3eefb2fba3434590abdc952a7ef7, as in the contract's known-answer table

const key = {
  host,
  harness: 'claude-code',
  harness_path: '/home/user/.claude',   // in a real adapter: realpathSync.native(folder)
  session_id: '11111111-1111-4111-8111-111111111111',
  incarnation: '',                       // this harness never reuses ids
};
```

## 2. Turn a transcript line into a message

Suppose the harness wrote this line:

```json
{"type":"user","uuid":"m-0001","timestamp":"2026-01-05T10:00:10.000Z","message":{"role":"user","content":"Hello."}}
```

A message record keeps the native id as `message_id`, normalises the role, and holds the content as
parts:

```js
const message = {
  type: 'message', ...key,
  message_id: 'm-0001', parent_id: null,
  order: '2026-01-05T10:00:10.000Z|main|000000', agent_id: '',
  to_user: null, to_model: null, status: 'complete', state: 'current', on_active_branch: null,
  ts: '2026-01-05T10:00:10.000Z', requested_model: null, served_model: null, effort: null,
  response_id: null, aliases: [], role: 'user', source: 'user',
  parts: [{ part_id: '0', kind: 'text', text: 'Hello.' }],
};
```

## 3. Add the session record, and seal both

The session record names the session once, and its `fingerprint` lists its messages' `cmp_sha`.
`seal()` from the reference provider computes `cmp_sha` and `content_sha`:

```js
import { seal } from '<harness-skeleton>/packages/session-adapters/src/records.js';

const m = seal(message);
const session = seal({
  type: 'session', ...key, engine: null, client: 'claude-code', harness_version: '1.0.0',
  title: 'hello', title_set_by: null, cwd: '/home/user/demo', last_cwd: '/home/user/demo',
  created_at: '2026-01-05T10:00:00.000Z', updated_at: '2026-01-05T10:00:00.000Z',
  state: 'active', pinned: null, mode: null, kind: null, reuse: 'impossible', ts_source: 'event',
  aliases: [], setup: null, fingerprint: { cmp_shas: [m.cmp_sha] },
});
```

## 4. Validate

```js
import { validateSession } from '<harness-skeleton>/packages/session-adapters/src/validate.js';

console.log(validateSession([session, m], { harness: 'claude-code', sessionId: key.session_id }));
// [] — no findings
```

An empty list means the records have the contract's shape. Compare them with
[examples/01-one-message](../examples/01-one-message/), which holds the same two records.

## Next

- Add an assistant reply with a tool call: [examples/02](../examples/02-parts-and-tools/).
- Write the four operations around this mapping: [Implementing a session adapter](implementing-an-adapter.md).
- Prove it: [Conformance](conformance.md).
