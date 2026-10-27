# Contract: sessions v1.3

**version:** v1.3
**between:** session adapters, one per harness, in the harness-session-adapters module of
[harness-skeleton](https://github.com/agent-realm/harness-skeleton) (provider) ↔ memhouse's capture engine,
the `sessions.*` shim in harness-skeleton's `hs` tool, and harness-sessions-sql loaders (consumers)
**status:** how an adapter reads a harness store and derives records, and who
keeps what

[sessions-model](sessions-model.md) defines what the records are. As there, `store` is the object
`{host, harness, harness_path}` (sessions-model §1) and never a consumer's database. This contract defines:
- the four adapter operations;
- what a source, a raw unit and a position are;
- what continuity means;
- the split of responsibilities: the adapter reads and derives; the engine keeps cursors,
  generations, the archive and every cross-session judgement.

It cites **sessions-model@v1**; it does not restate it.

## 1. Sources, units and positions

A session is read through one or more **sources**. Each source is one of three modes:
- **`stream`**: an append-only sequence of units. Earlier units never change in place, and a
  rewrite is a reset. Examples: a JSONL file, the OpenCode `event` log (`seq`).
- **`delta`**: a set of mutable units that can be inserted, updated in place or deleted. Examples:
  a slice of a table (Goose `messages`, OpenCode `message` / `part` and v2 `session_message`, agy
  steps), a key prefix in a key-value table (Cursor bubbles), an immutable content-addressed table
  read as keys (cursor-agent `blobs`), the rows of a sidecar DB.
- **`snapshot`**: one unit that is replaced whole. Examples: a Zed thread blob, a Devin node tree
  (several rows read in one transaction, `enc: rows-json`), the cursor-agent `meta` row, a
  sidecar file.

`list` names the sources:

| Field | Values |
|---|---|
| `source_key` | stable within the session, one of: a path relative to `harness_path`; for a source the harness keeps outside it, by override (pi `--session-dir`) or by design (Cursor IDE `agent-transcripts`, the VS Code `agentSessionData` of a Copilot session), its absolute real path under the same resolver rule (sessions-model §1); a `table:<name>` / `kv:<prefix>` / `blob:<id>` name inside the harness's one database; or `<path>#table:<name>` / `<path>#kv:<prefix>`, naming a table in a given database file, where `<path>` is relative to `harness_path` or absolute as above (Zed's per-channel `db/<channel>/db.sqlite`, agy's `conversation_summaries.db` beside each `conversations/<id>.db`); or one of those followed by `@<slice>`, naming a slice that every session of the harness store reads alike (Goose's first ledger row, `sessions/sessions.db#table:usage_ledger@first`, which its derive needs to place compaction). `#` never occurs in the path part, nor `@` in a slice's table or prefix |
| `role` | `main` \| `agent` (a sub-agent's file within this session) \| `side` (sidecars, indexes, alternate views) |
| `mode` | `stream` \| `delta` \| `snapshot` |
| `position_kind` | one of the kinds below |

A unit's `unit_key` and a source's position, per position kind:

| `position_kind` | `unit_key` | position (high-water mark) |
|---|---|---|
| `byte_offset` | the unit's start offset within the current generation | `{dev, inode, offset}` of the next unread byte; host-local |
| `rowid` | `<table>:<rowid>` | the highest rowid read, plus the DB's `data_version` |
| `seq` | the native sequence number | the highest seq read |
| `time_updated+id` | `<table>:<primary key>` | `(time_updated, id)` of the last row read |
| `root_blob` | the blob's sha256 | the current root blob id |
| `kv` | the KV key | none: the engine's `known` map drives change detection |
| `pk` | `<table>:<primary key>` | none, as for `kv`: for a table whose rowid is not stable and that has no update time (OpenCode v2 `session_input` by `id`) |
| `snapshot` | `source_key` (one unit per source) | the content sha of the last snapshot read |

Modes and position kinds go together:
- `stream` sources use `byte_offset`, `seq` or `root_blob`;
- `delta` sources use `rowid`, `time_updated+id`, `kv` or `pk`. Their position is only a hint,
  and `known` decides what changed;
- `snapshot` sources use `snapshot`.

**Several `main` sources.** A session may have more than one (Codex rollouts that share an
id). Raw units carry no time of their own, so the order comes from the records `derive` makes:
the sources are ordered by the `ts` of the first record each one yields (sessions-model §1
rule 7; a source whose first record has none sorts first), then by `source_key`. Message
`order` (sessions-model §2.2) follows that: an adapter composes it from the source's place in
that order and the record's position within the source, so `order` is unique across sources.

A source the harness keeps outside `harness_path`, by override or by design, still belongs to
the harness store keyed by the bound `harness_path`, as pi's `--session-dir` does (sessions-model
§1). Its absolute `source_key` names where it is read, never another harness store.

Positions are opaque to the engine. It stores them verbatim per (`store`, session, `source_key`),
never compares them across kinds, and never carries them to another host. A position from
another host counts as absent, which forces a full read.

## 2. The adapter (provider)

The adapter is read-only toward the harness. It never takes a harness lock and never writes into
the harness store. It must tolerate a live writer:
- WAL-only rows;
- a partial last JSONL line;
- temp-file-and-rename rewrites;
- `-shm` files that a read-only open creates.

| Operation | Takes | Returns |
|---|---|---|
| `describe` | nothing (v1.1: optional `features`) | see below |
| `list` | `store` | per session: `session_id`, `incarnation`, `updated_hint`, `live` (`true` \| `false` \| `unknown`), `sources` (§1) |
| `read` | `store`, `session`, `source_key`, `from` (position or none), `known` (the engine's `{unit_key: sha256}` for this source, or none) | `continuity`, `units` (bodies), `gone` (unit_keys), `position`, `held_back`; or a typed error |
| `derive` | `session`, `input` (per source: `generation`, and either all units of that generation or the new and changed units plus `gone`), `state` (opaque, or empty) | `changed` (the records whose final state changed), `live` (the **complete** set of live keys, per record type), `held` (keys withheld as incomplete, per record type; below), a new `state` carrying `state_ver`, and a `checkpoint` flag (state is safe to persist) |

v1.1: every operation also takes an optional `features` (§5). With `features: ["forget-notice"]`,
`describe` adds the facet `forget_notices`; `list` and `read` take `forgets_from` and return
`forgets` and `forgets_position`; `derive` returns `built_from` (Feature `forget-notice`, below).

`describe` returns:
- `adapter`, `adapter_ver`, `model_version` (`sessions-model/1`), `harness`, `state_ver`;
- version ranges: certified and compatible;
- its sources: for each `source_key` pattern, the `role`, `mode`, `position_kind` and `enc`.
  - A **pattern** is a `source_key` with each variable segment written as a `<name>` placeholder,
    for example `projects/<encoded cwd>/<session>.jsonl` or `<db>#table:steps`. It documents the
    sources; a consumer never matches against it, because `list` names every source exactly.
  - One role can hold sources of different modes. OpenCode's `side` sources are a snapshot row,
    delta slices and a stream of events; Goose's are a snapshot row and a delta slice;
- `store_shape`: what `harness_path` names for this harness (sessions-model §1): `{kind: 'folder'}`,
  or `{kind: 'file', default, names}` for a harness whose every harness store is one database file
  (OpenCode: `default: 'opencode.db'`, `names: ['opencode.db', 'opencode-<channel>.db']`). A
  binder (harness-skeleton's `hs` tool) reads it instead of keeping its own list;
- `ts_source`;
- the redaction field paths and lint exemptions (sessions-model §4);
- `volatile`, where a snapshot source has fields the harness rewrites without the conversation
  changing (Cursor IDE's view state, gauges and height hints): per source, the field paths `read`
  leaves out, so an unchanged session reads as unchanged;
- the facets below.

`read` errors:
- `session_unknown`; `incarnation_gone` (the id now belongs to a later incarnation);
  `source_unknown`. These are final for the request.
- **Retryable:**
  - `busy`: the harness holds a lock past the adapter's wait (a SQLite `SQLITE_BUSY`, a
    rollback-journal writer);
  - `inconsistent`: the read saw a state the harness never commits whole: a torn view across rows
    or sources (Cursor IDE's listed bubble that is not there yet, Devin's `main_chain_id` pointing
    at a node another transaction has not written, cursor-agent's missing blob). Only the main line
    itself tears a Devin read: its head and the parent links along it. A node the main line only
    names (a sub-agent head, a compacted history's prior nodes, a sub-agent chain a tool result
    names) that the read lacks does not (v1.3):
    - derive leaves out what that node would have reached, and the raw unit keeps the naming row;
    - records derive wrote earlier among them are `held`, and so are a compaction record and its
      summary that point into the missing nodes;
    - records the gap only moves (a message's `order`, the session's `fingerprint`) are revised,
      and revised back once a later read holds the node and derives it;
  - `damaged`: a corrupt page, or a committed row that does not parse.

  The engine retries all three with backoff. It never treats them as an empty or vanished source.
  `damaged` that persists across retries is reported for the session, and the session keeps its
  last derived state.
  A retryable error that outlasts the engine's retry budget while the session's `updated_hint` is
  unchanged is reported for the session: the engine stops retrying that session until
  `updated_hint` moves, apart from its scheduled re-read (below), and the session keeps its last
  derived state (v1.3).

**`updated_hint`** is the adapter's opaque change key for a session: a cheap value, read by `list`,
that moves when the session's content moves (a file's size and mtime, an index row's update
time plus a slice's row count and maximum id). A consumer may skip `read` for a session whose
`updated_hint` has not moved since its last complete pass. It still re-reads every session on its
own schedule (for example once a day), because a hint can miss a change (Cursor IDE's composerData
edits without a header bump). When `read` runs, rule 4 below holds unchanged.

`read` is **stateless**. Precedence, in order:
1. **Initialisation.** A read with no `from` and no `known` returns every current unit, as
   `reset` with generation 1, whatever the mode.
2. **Reset evidence.** If a stream's `from` no longer holds (an inode change, a shrink, a line-1
   change, a root that moved backwards), the adapter returns `reset` with every current unit.
3. **`stream` sources** read from `from` alone, and return `appended` or `unchanged`. `known` is
   ignored.
4. **`delta` sources** always diff the source's current units against `known`, whatever `from`
   says. They return the bodies of new and changed units plus `gone`, as `delta` or `unchanged`.
   An in-place edit or a deleted row is found only this way; a high-water mark cannot see it.
5. **`snapshot` sources** return the whole unit as `snapshot` when its sha differs from `from`,
   and otherwise `unchanged`.

`derive` is **pure**: it never touches the harness store, and the same input and state give the same
output on any host.
- `live` lets the engine tombstone exactly: after `{A, B}` becomes `{A}`, B is absent from `live`,
  while A is retained even when it did not change.
- **`held`** names records the derive withholds as incomplete. Most harnesses decide completeness
  at record level, after folding several units or sources: a tool call whose result has not
  arrived, a turn that a stored row marks as still streaming (Cursor IDE's
  `generatingBubbleIds`), an assistant message whose listed parts are not all stored.
  - A held key is neither written nor tombstoned in this pass. Its last written version, if any,
    stands. A held key is never also in `changed` or `live`.
  - A key that was written before and is now held again (Cursor IDE regenerating a reply after an
    edit, a Gemini record revised with a pending call) therefore does not disappear and return.
  - Unit-level holds stay in `read` (`held_back`, §3). `held` is only for what a single unit
    cannot show.
- `derive` with empty state over every unit of every source's current generation is the **full
  replay**. The engine uses it for an `adapter_ver` upgrade from its archive,
  and to replay fixtures.
- **When any source of a session resets**, the engine re-derives the whole session from empty
  state over all sources' current units. State never survives a reset of any source.

**Facets** (in `describe`). harness-skeleton grades the same facets for mechanism, fidelity and
readiness.

| Facet | Values |
|---|---|
| `list` | `exact` \| `partial`: name the gap (Copilot's `session-store.db` misses failed sessions, so its adapter lists directories) |
| `read` | `exact` \| `lossy`: name the loss (for example, identity lossy for a rewriting harness store without native ids) |
| `reuse` | `impossible` \| `detected` \| `undetectable` (sessions-model §1 rule 2) |
| `lifecycle.<op>` for rewind, edit, compaction, delete, archive, unarchive, rename, pin, unpin, fork, clear | `explicit` \| `implicit` \| `invisible` |
| `linkage.<kind>` for the link kinds fork, subagent, rewind_copy, clear, continuation | `explicit` \| `inferable` (the engine can nominate it from fingerprints) \| `none` |
| `linkage.tool` | tool call ↔ result pairing within a session: `native` (by call id) \| `positional` (agy jsonl) \| `none` |
| `linkage.compaction` | summary → replaced range: one of the `summary.replaces` forms (sessions-model §2.3), or `none` |
| `join.hook` | `yes` \| `derived` (with the rule: through `transcript_path`, through an alias, or as `(session, agent_id)`) \| `no` |

### Feature `forget-notice` (v1.1)

A harness admin can deliberately delete some of a session's records, or a whole session: a
**forget**. The `forget-notice` feature carries that decision to consumers, so they can forget the
same records instead of keeping them as removed versions. A source deletion (a message deleted in the
harness, a destructive rewind, a deleted session) is not a forget: it produces removed versions,
never a forget notice. Every input and output below exists only for a consumer that names
`forget-notice` in `features` (§5).

**Who writes notices.** The harness that owns the harness store writes them, into a notice store
inside the harness store (for example one append-only file). The adapter only reads that store, like
the rest of the harness store. The harness's duties:
- it writes a notice, durably (an fsync for a file), before it deletes anything the notice names;
- it keeps every notice for as long as the harness store exists;
- it never writes one for a source deletion;
- a notice holds exactly the five fields below.

**The forget notice:**

```json
{"forget_id": "f-01", "session_id": "11111111-1111-4111-8111-111111111111", "incarnation": "",
 "scope": {"keys": [{"type": "message", "message_id": "m-0042"},
                    {"type": "usage", "usage_id": "response:r-7"}]},
 "at": "2026-01-05T10:00:00.000Z"}
```

- **`scope`** is the string `"session"` (the whole session) or `{"keys": [...]}`.
- **Each key** is a record key: its `type` (`message`, `usage`, `lifecycle` or `link`) plus that
  type's key fields from sessions-model §1. `session` is never a key type; a whole session uses
  `"scope": "session"`. A part cannot be forgotten alone: forget its message.
- **Every forgotten key is listed; nothing cascades.** A message's parts go with their message,
  because a part's key is the message key plus `part_id`. A usage, lifecycle or link record is
  forgotten only when it is listed.
- **Content-free:** no text, no reason and no person, and no hash beyond what a record key itself
  contains (sessions-model §1). `forget_id` is opaque and unique in the harness store.

**`describe`** returns the facet `forget_notices`: `none` (the harness has no forget) or `delivered`
(the adapter delivers notices as below).

**`read`** takes `forgets_from`, the literal `"start"` or a `forgets_position` from an earlier `read`
of the same session. It returns:
- `forgets`, possibly empty: every notice of the session whose scope is keys, written after
  `forgets_from`, whatever the `continuity`, `unchanged` included;
- `forgets_position`.

**`list`** takes `forgets_from`, the literal `"start"` or a `forgets_position` from an earlier `list`
of the same harness store. It returns:
- `forgets`, possibly empty: **every** notice written after it, whatever its scope and whether or
  not its session can still be read;
- `forgets_position`.

`list` is the complete feed: a notice for keys of a session deleted afterwards, or of an incarnation
that can no longer be read, still reaches the consumer there. `read`'s `forgets` delivers a
session's key-scope notices in the same call as the change they explain. A consumer may see a notice
in both, and applies it once (§4).

**Positions.**
- `read`'s positions are per session, and `list`'s per harness store. They are never interchangeable.
- A position is opaque and host-local, and the consumer stores it verbatim.
- An adapter that no longer recognises a position returns every notice from the start. That is safe,
  because a consumer applies each notice once.

**Timing.**
- **After any forget of keys, the session's `updated_hint` moves:** it differs from every value
  `list` returned before the notice was written. It is computed the same way with or without
  `features`. A consumer that reads only on a moved hint therefore reads again and gets the notice.
  That covers the main case: forgetting keys already gone from the current generation, which no v1
  read could show.
- **A session forgotten whole is absent from `list`'s sessions only in a `list` that also returns
  its notice, or after one did.** To meet that:
  - the harness writes the notice before it deletes the session;
  - `list` enumerates the sessions first, then reads the notices, holding back a partial last line
    of a file-based notice store.

**`derive`** returns `built_from`, a list of `{"record": <record key, as in a notice>, "units":
[{"source_key", "unit_key", "sha256"}, ...]}`.
- **Which units:** the units that hold the record's own content. A unit that only gives context (a
  session header, a sidecar, a slice shared by every record) is not listed.
- **Which records:** every record in `changed`. With the feature, a record whose `built_from` changed
  is in `changed` even when its content did not, so the consumer's map never goes stale. For
  example, a snapshot rewrite or a shared row edit changes `built_from` for the kept records too.
- **The adapter keeps what it needs in the derive state.** A consumer that starts naming the
  feature re-derives each session once from empty state (the full replay), so `built_from` covers
  every live record.
- **Required** with `forget_notices: delivered`.

A consumer that archives raw units uses `built_from` to find what a notice reaches. Without it, such
a consumer cannot map keys to units: it keeps the archived bytes and filters the forgotten keys out
for good (§4).

**Security.** A notice is honoured on the harness store's word: the protocol does not authenticate
it, so anything that can write the harness store can write one. Consumers are recommended to hide
the records at once and delete them only on their admin's confirmation, so a forged or buggy notice
costs nothing that cannot be undone.

## 3. Continuity

Continuity is **per source**, and it is defined over **raw units, not records**. A unit may
revise a record that was derived earlier, such as Claude usage growth, a tool result, a Gemini
`$patch` or a VS Code `kind 1`. That is normal under every continuity value.

| `continuity` | Meaning | Typical sources |
|---|---|---|
| `appended` | `units` are exactly the units after `from`. Every earlier unit is unchanged | JSONL streams; explicit retractions (Gemini `$rewindTo`, VS Code `kind 2`) arrive this way too |
| `delta` | `units` are the bodies of new and changed units, measured against `known`, and `gone` lists the vanished unit_keys | SQLite and key-value harness stores that update in place: Cursor bubbles, Goose's `agentVisible` flip, OpenCode `session.revert`, agy rows; cursor-agent's new blobs (a rewind moves its root, which is a `snapshot` change of the `meta` row, never a reset) |
| `reset` | the adapter cannot enumerate what changed, so `units` are the full current content under a new `generation` | an inode change or shrink (a Copilot rewind, a CommandCode migration), a droid line-1 rewrite (length **or sha** changed) |
| `snapshot` | a snapshot source changed: `units` is its whole content as one unit | a Zed thread blob, a Devin node tree, sidecars |
| `unchanged` | nothing new or changed since `from` and `known`: `units` is empty | any source |

**Held back.** A unit that is not complete is never returned: a partial last line, a multi-row
write the harness has not finished (for example, an assistant row with no completion marker). A committed row is complete even when it sits only in the WAL, and it is
returned. Completeness that only the fold can judge (a tool call with no result yet, a listed part
not yet stored) is withheld by `derive` as `held` (§2), not by `read`.

## 4. The engine (consumer: memhouse's capture engine)

The engine owns:
- the cursor per (`store`, session, `source_key`), with its generation;
- the archive of raw units;
- `rev`, tombstones and totals;
- inferred cross-session links, from session fingerprints (`evidence: inferred`);
- billing inherited usage once;
- recall.

After every derive, the engine tombstones each **adapter-owned** key that it held for that
session and that is absent from both `live` and `held`: messages, usage records, lifecycle
records and link statements. Append-only retractions are not tombstones; they stay in `live`
with `state: retracted`.

**Removed versions instead of tombstones.** A consumer may keep a vanished key as a **removed
version** rather than a tombstone: a full copy of the key's last row, written at a higher `rev`,
marked removed (for example a separate removed flag, so the row's adapter-set `state` is
preserved). The rules for such a consumer:
- a removed version is never counted as live: not in totals, current-state reads or billing;
- it stays searchable as history, and readers filter on the removed mark;
- if the key comes back in a later `live`, it is written again as current, at a higher `rev`.

The choice between tombstones and removed versions is consumer policy, and either satisfies this
contract. Physical deletion stays reserved for rows that are not session history: true
duplicates, and keys that an upgraded adapter no longer produces at all.

Merged and inferred **edges** are the engine's own projections, and are never reconciled against
an adapter's `live`. An edge ends when its last supporting statement is tombstoned or removed, or
(when inferred) when re-verification fails.

The engine also:
- **resolves link references** against the sessions it holds;
- **merges** the two statements of one edge (sessions-model §2.5);
- **verifies a fingerprint-nominated fork** on full records before it assigns `inherits` or
  bills anything.

**Forget notices** (feature `forget-notice`, v1.1). A consumer that opts in names the feature on
every `list`, `read` and `derive`. It **honours** notices when it:
1. applies a call's `forgets` before it acts on that call's other outputs;
2. writes no removed version for a forgotten record. The consumer keeps the set of **forgotten
   units**: the sha256 of every unit that a forgotten record was built from (`built_from`). These
   are already in its `known`. A record under a forgotten key is **new content** only when none of
   its units is a forgotten unit. Receipt order never decides it: after a crash between the notice
   and the deletion, or on a full re-read, the old units come back unchanged, and the record stays
   forgotten. Without `built_from`, a forgotten key never comes back;
3. stops serving the forgotten records at once:
   - in every read, search and total;
   - in its own derived copies of them (indexes, embeddings, caches, rows it converted from an older
     format of the same records);
   - through every reader it delegates to, removed-row readers included.

   Other sessions' records, such as a fork's copied messages, are not forgotten unless a notice
   names them;
4. deletes under its own policy, which says how far deletion reaches and when. On its admin's
   confirm it drops each archived forgotten unit. A forgotten unit that also built a kept record
   (a **mixed unit**) is dropped too. The kept record's row stays, and the consumer marks it as
   having **no raw source**;
5. applies a notice once, by `forget_id`, and records every notice it receives, including one for a
   session it does not hold yet;
6. treats a whole-session notice as a forget, never as a source deletion;
7. applies what it has forgotten in every re-derivation: an upgrade refold, a replay of any archived
   generation, a replay from its archive. In each one, it serves no record that has a forgotten key,
   and no record whose units are all forgotten units, whatever its key. When an `adapter_ver` bump
   changes keys (sessions-model §1 rule 8), the first test uses the bump's migration note, and the
   second catches what the note misses. A row marked as having no raw source is left as it is: no
   re-derivation rebuilds it, removes it, or tombstones it.

A consumer that applies one read in several steps (a capped batch at a time) applies the read's
notices at the first step.

**Where the rules above yield.** For a consumer that honours notices, the v1 text of this section
yields to the forget rules:
- a forgotten record is never tombstoned or kept as a removed version, and a forgotten key in `held`
  is hidden all the same;
- deleting forgotten records is physical deletion of history, allowed only through a forget;
- an edge also ends when its last supporting statement is forgotten.

A consumer that does not opt in keeps v1's behaviour: removed versions of what the harness forgot.

## 5. The contract

- **Code does not cross the seam.** Only the operations, units, records, positions and facets do.
  An adapter can be any implementation that passes conformance, including a separate executable
  speaking the JSON form of the four operations. The reference home is the harness-session-adapters
  module in harness-skeleton. harness-skeleton's `hs` tool wraps it and never
  re-implements a reader.
- **Versions.** `model_version` major, `adapter_ver` and `state_ver` travel with every output. A
  model major mismatch refuses the adapter. A `state_ver` change makes the engine re-derive from
  the archive with empty state.
- **Every closed list is final for v1:** every field this contract defines as an enum or a fixed
  set of values. Adding a value to one needs v2, because a v1 consumer may refuse an unknown
  value. Among them:
  - a source's `role` and `mode` (§1);
  - `continuity` (§3);
  - `list`'s `live`, and the `read` error codes (§2);
  - each facet's values (§2).

  A **registry**: a source's `position_kind` (§1), which grows with the storage formats harnesses
  use. A new kind comes in a v1.x. Positions are opaque to the engine, so a v1 consumer stores the
  position of an unknown kind verbatim.

  sessions-model's are listed in its §8.
- **Features (v1.x).** A v1.x adds behaviour as a named **feature**: optional inputs, and outputs
  that an adapter returns only when the consumer names the feature in an operation's `features`
  input (a list of feature names). Without `features`, an adapter behaves exactly as v1. A
  consumer learns whether an adapter supports a feature from `describe` called with it: a feature
  with a facet (such as `forget_notices`) is supported when that facet comes back, and an adapter
  that returns no such facet is treated as v1, whether it ignored or refused the input. A feature's
  facet values are a closed list from the version that adds it. No closed list of v1 gains a value
  in a v1.x.
- **Redaction is the adapter's.** Units and records arrive already redacted (sessions-model §4).
  The engine never re-reads the harness store to recover a value.

## Conformance

**Adapter side** (the sessions-only profile certifies these plus the sessions-model checks):

- [ ] `describe` states every facet. Each `explicit` lifecycle or linkage claim is backed by a
      fixture that produces the record.
- [ ] **Positive control.**
      - Stream sources: after one appended turn, a `read` from the returned position gives
        `appended` with exactly the new units.
      - Snapshot and delta sources (Devin, Zed, Cursor IDE): after one appended turn, the derive
        output keeps every earlier key unchanged, adds the new ones, and yields no tombstone.
- [ ] **Negative control:** an implicit rewrite of a stream source between two reads (a Copilot
      rewind: new inode, shorter file) gives `reset`. The full re-derive then omits exactly the
      vanished keys from `live`. An append-only retraction (Gemini `$rewindTo`) stays
      `appended`.
- [ ] **Delta with `known`:** for a source that updates in place, `read` with the prior `known`
      returns the changed row's new body (same `unit_key`, new sha) and lists a deleted row in
      `gone`. Without `known`, it returns every unit.
- [ ] **Live keys:** every `derive` returns the complete `live` set. A record removed from the
      session's current units is absent from it, and an unchanged record stays in it.
- [ ] **Unchanged:** a second read with nothing new gives `unchanged` and no units.
- [ ] **Held back:** a partial last line or a streaming turn is not returned, and the next read
      returns it whole. A committed WAL-only row is returned.
- [ ] **Errors:** reading a deleted session gives `session_unknown`. Reading an id that was reused
      under `reuse = detected` with the old incarnation gives `incarnation_gone`. A harness store
      held under a writer's lock gives `busy`, and a damaged page gives `damaged`; neither is reported
      as an empty or vanished source.
- [ ] **Held:** a record written once and then withheld again (a reply regenerated after an edit)
      is in `held`, not in `changed` or `live`. When it completes, it returns in `changed` and
      `live`.
- [ ] `list` omits a deleted session, even where a native index keeps orphans (Copilot
      `session-store.db`).

**Feature `forget-notice`** (v1.1), for an adapter that states `forget_notices: delivered`, tested
against harness-store fixtures that include a notice store:

- [ ] Without `features`, every output is exactly v1: no facet, no `forgets`, no `built_from`.
- [ ] A forget of keys still in the current generation arrives in `forgets` no later than the read
      that shows its `reset`, `delta` or `snapshot`.
- [ ] A forget of keys already deleted in the source moves the session's `updated_hint`, and the
      next read returns the notice in `forgets`, though the read itself is `unchanged`.
- [ ] A forget of a whole session arrives in `list`'s `forgets` no later than the first `list` where
      the session is absent. With a fixture whose notice is written but whose session still exists
      (a crash between the two), the session is listed and the notice is delivered.
- [ ] A forget of keys followed by an ordinary deletion of the session, before any consumer reads
      again, still reaches the consumer through `list`'s `forgets`.
- [ ] Every notice the adapter emits has exactly the five fields; with planted sentinel text in the
      session, no notice carries it.
- [ ] A source deletion in a fixture without notices produces no `forgets`.
- [ ] `forgets_from: "start"` returns every notice in the notice store; an unrecognised position
      returns every notice too.
- [ ] `built_from` lists, for every record in `changed`, the units that hold its own content, with
      their sha256, and no context unit. A record whose `built_from` changed, with unchanged
      content, is in `changed`.

The harness's own duties (writing before deleting, keeping notices for the harness store's life,
never writing one for a source deletion) are the harness's to prove, by the fixtures it produces.

**Engine side** (memhouse):

- [ ] **Held:** a key that the consumer wrote earlier and that a later derive returns in `held`
      keeps its last written version: it is neither rewritten nor tombstoned until it is back in
      `live`.
- [ ] A copy of one data folder on two hosts gives two sets of sessions, each keyed by its own
      `(host, harness, harness_path)`, with its own cursors and continuity.
- [ ] One folder reached through a symlink, or a differently cased spelling on a
      case-insensitive volume, gives one `harness_path` and so one set of sessions.
- [ ] Inherited usage is billed once: a fork copy with `usage_copied` does not raise the combined
      totals.
- [ ] **`per_record` reading** (sessions-model §2.4):
      - N ≥ 2 `per_record` usage records repeating one response's usage under one `response_id`
        count once, as their last record in order, which carries the greatest `output` (the
        early records of a streamed response carry a partial one);
      - beside a `per_response` usage with the same `response_id`, they add nothing.
- [ ] Inferred links: a fork that the fixtures show only by shared ids or content (OpenCode
      `(fork #N)`, Cursor IDE `(1) <name>`) is nominated by `cmp_shas`, verified on full records,
      and recorded with `evidence: inferred`. It is never emitted by an adapter.
- [ ] Link resolution and merge:
      - Goose's child-side `parent_session_id` reference resolves to the parent's full key when
        exactly one candidate matches, and stays unresolved otherwise.
      - The OpenCode subagent pair in `opencode/features/` (the child's statement with `at: ''`
        and the parent's `task` call) becomes one edge, `stated_on: both`, with that call
        as `at`.
- [ ] Edge lifetime: re-deriving the child alone does not delete the merged edge while the
      parent's statement stands. Removing both statements ends it.
- [ ] A consumer that keeps removed versions never counts them as live: after a rewind, the totals
      and the current-state reads equal those of a tombstoning consumer.
- [ ] An `adapter_ver` or `state_ver` bump re-derives from the archive alone and tombstones keys
      the new version no longer produces.

**Feature `forget-notice`** (v1.1), for a consumer that claims to honour notices:

- [ ] After a forget of keys, no removed version of those records exists, and they are served
      nowhere: not in reads, searches or totals, not in the consumer's own derived copies, and not
      through its delegated readers.
- [ ] After a whole-session forget, nothing of the session is served, and no removed version exists.
- [ ] A notice delivered through both `read` and `list` changes nothing the second time, and its
      `forget_id` is recorded once.
- [ ] Stopped after a read and restarted, re-reading with `known` from its archive, it still applies
      the notice, because it passed `forgets_from`.
- [ ] An upgrade refold and a replay from the archive bring no forgotten record back, under its old
      key or a new one, and leave rows with no raw source as they are.
- [ ] A record under a forgotten key built from new units (a different sha256) is kept as new
      content; after a crash between the notice and the deletion, or on a full re-read, the old
      units do not bring the record back.
- [ ] After its admin's confirm, its archive holds no forgotten unit; a mixed unit is gone too, and
      its kept record's row is marked as having no raw source.
- [ ] A source deletion still produces removed versions.

## Verification status

v1.3. The provider is the harness-session-adapters module in harness-skeleton
(`packages/harness-session-adapters`), with an adapter for twelve harnesses: Claude Code, Codex, Copilot
CLI, Gemini CLI, VS Code, Goose, OpenCode, agy, Cursor IDE, cursor-agent, Zed and Devin Local.
Every v1 adapter-side item above and every sessions-model item is proved for each of them, or
marked not applicable with its reason, in the module's conformance matrix
(`packages/harness-session-adapters/docs/conformance-matrix.md`), which its test suite keeps current. The
`forget-notice` items are not proved yet: no harness writes forget notices today, so every adapter
states `forget_notices: none`, and no consumer honours them yet. The v1.3 rules (sessions-model §8,
the `is_error` item, and the Devin and retry rules in §2 here) are proved in the same matrix from
the module's 1.0 release.

The first consumer is memhouse's capture engine. The engine-side items are the consumer's to
pass.

Live behaviour the fixtures cannot show (a paid plan's numbers, a store written while a turn
streams) is checked on a lab machine with each harness signed in. What is still unchecked is
listed in the module's `docs/live-check.md`, and what a check settles goes into the annex.

Scripted-conversation checks (a scripted conversation read back exactly) are harness-skeleton's,
run against a scripted model endpoint, and the reference harness
(`reference-harness`), which harness-skeleton plans, will be their first exact producer.
