# Conformance

v1 means the shape and every closed list are frozen. A contract reaches v1 when one provider passes
its checklist; until one consumer also passes, it is listed as **v1 (consumer pending)**.

## An adapter

An adapter may claim `sessions-model@v1` and `sessions@v1` when it passes the adapter-side items:
- of [sessions-model](../contracts/sessions-model.md), in its *Conformance (adapter side)* section;
- of [sessions](../contracts/sessions.md), in its *Conformance* section.

The items are checked on fixtures. Most items name the fixture that proves them. The main groups:
- **identity**: the known-answer vectors for `host` and `harness_path`, keys that survive a lost
  state and a re-derive, incarnations, anchored and positional ids;
- **replay**: every incremental split of the same units gives the same final state;
- **history**: explicit links, retraction against destruction, compaction that is not deletion;
- **redaction**: sentinel secrets never appear, and their paths show the marker;
- **usage**: the two flags per harness, no overlap, and `tool_prompt`.

Some harnesses certify the **sessions-only profile**: this model and the sessions seam, without the
rest of a harness skeleton.

## A consumer

A consumer passes the engine-side items of [sessions](../contracts/sessions.md): cursors and
generations, reconciliation against `live` and `held`, retrying retryable errors, and reading
`per_record` usage once per response.

## Where the results live

The reference provider, the harness-session-adapters package in
[harness-skeleton](https://github.com/agent-realm/harness-skeleton), keeps a conformance matrix: one
cell per item and harness, each citing the test or fixture that proves it, or saying why it does not
apply.

## Checking a record by hand

Every file in [examples](../examples/) passes the provider's record validator.
[`examples/generate.mjs`](../examples/generate.mjs) shows how to call it on your own records.
