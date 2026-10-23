# Implementing a session adapter

A session adapter reads one harness's store and turns it into sessions-model records. It is
**read-only** toward the harness: it never writes to, locks or repairs the harness's files.

## The four operations (sessions §2)

| Operation | Takes | Returns |
|---|---|---|
| `describe` | nothing | what the adapter is: its harness, versions, the facets it supports, `store_shape` (whether a harness store is a folder or a database file), and, per source pattern, its role, mode, position kind and encoding |
| `list` | a `store` | per session: `session_id`, `incarnation`, an opaque `updated_hint`, whether it is `live`, and its sources |
| `read` | a `store`, a session, a `source_key`, the last position, and the consumer's `known` unit hashes | a `continuity` value, the new or changed units, the vanished unit keys, a new position; or a typed error |
| `derive` | one session's units per source, and the previous opaque state | the records whose final state changed, the complete set of live keys, the keys `held` as incomplete, and a new state |

`read` deals in **raw units**, the native pieces as stored (a JSONL line, a row, a blob), each with
the sha256 of its bytes. `derive` is a **pure function** of the units and the state: it never touches
the harness store, and the same input gives the same records on any machine.

## Continuity (sessions §3)

Each `read` reports how its source changed since the last position:

| Value | Meaning |
|---|---|
| `appended` | only new units after the position; earlier units are unchanged |
| `delta` | new and changed units against `known`, plus the vanished keys |
| `reset` | the adapter cannot say what changed: the whole content, under a new generation |
| `snapshot` | a whole-unit source changed: its full content as one unit |
| `unchanged` | nothing new |

A unit that is not complete (a partial last line, a write still in progress) is **held back** and
never returned. Completeness that only the fold can judge, such as a tool call whose result has not
arrived, is reported by `derive` as `held`.

Three read errors are **retryable**: `busy` (the harness holds a lock), `inconsistent` (a torn view
across rows or sources) and `damaged` (a corrupt page). The consumer retries them; it never takes one
as an empty or vanished source.

## Rules that are easy to miss

- **Redaction happens in the adapter** (sessions-model §4). Each declared secret path is replaced by
  `"<redacted len=N>"` before a unit leaves the adapter, and each unit decides its own redaction.
- **Usage is copied, never converted.** Set `input_includes_cache` and `output_includes_reasoning`
  from the vendor's definition; leave a flag null until something establishes it.
- **Only explicit links and lifecycle records.** State a link or a lifecycle operation only where
  the harness store records it.
- **`setup` is null** unless the harness store records the setup a session ran under.

## Start from the examples

The [examples](../examples/) are valid output, and [Conformance](conformance.md) lists what to prove.
