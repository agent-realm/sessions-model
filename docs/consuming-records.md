# Consuming records

A consumer (a memory store, a dashboard, an importer) keeps what adapters derive. The adapter
owns the record shape; the consumer owns the cursors, the archive and the history (sessions §4).

## Keeping a session current

1. Keep a cursor per (`store`, session, `source_key`), with its generation, and pass the last
   position and the `known` unit hashes to `read`.
2. Archive the raw units. They are the truth: records can always be re-derived from them.
3. Pass the units to `derive` with the last state, then upsert every record in `changed`.
4. **Reconcile against `live`.** Any key you hold for the session that is absent from both `live`
   and `held` is gone: tombstone it, or keep it as a removed version (a copy of its last row at a
   higher `rev`, marked removed, never counted as live). A `held` key keeps its last version.
5. Append-only retractions are not removals: those messages stay, with `state: retracted`.

## Summing usage

Usage records of one session never count the same tokens twice (sessions-model §2.4), so they can
be summed after two steps:

- **Totals.** Total input is `input` when `input_includes_cache` is true, and
  `input + cache_read + cache_write` when it is false. In both cases add `tool_prompt` where it is
  not null. Total output is `output` when `output_includes_reasoning` is true, and
  `output + reasoning` when it is false.
- **The one overlap, `per_record`.** Rows stored as given that repeat one response's usage on each
  record of the response have `granularity: per_record`. Count one per `response_id`; where a
  `per_response` record shares that `response_id`, count it instead. No adapter emits
  `per_record`; it appears only in rows kept as given from older stores.

## Links

A link's other side is a **reference** (`{harness, session_id}`, and the incarnation where known),
which you resolve against the sessions you hold. A fork stated on the child and the same fork
stated on the origin are one edge, which you merge.

## Never

- Never key anything on a hostname, a timestamp or the content.
- Never treat a retryable read error as an empty source.
- Never read a harness store directly; read through an adapter.
