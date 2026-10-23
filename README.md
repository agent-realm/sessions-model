# sessions-model

**What a coding-agent harness keeps, as one model, and how an adapter reads it.**

Every agent harness (Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor, OpenCode, Zed and
others) keeps its conversations on disk in its own format, and changes that format often. This
repository holds two contracts that turn those formats into one shape:

- **[sessions-model](contracts/sessions-model.md)**: the records (session, message, part, usage,
  link, lifecycle, raw unit), their keys and the rules that keep them stable across hosts, copies
  and rewrites.
- **[sessions](contracts/sessions.md)**: the four operations a session adapter exposes
  (`describe`, `list`, `read`, `derive`), how a read reports what changed, and who keeps what.
- **[the annex](contracts/sessions-model-annex.md)**: what each harness actually stores, as
  observed, with the fixtures that prove it.

[TERMINOLOGY.md](TERMINOLOGY.md) is the vocabulary. Its *Sessions* section defines every term the
contracts use.

## Start here

- **[docs/tutorial.md](docs/tutorial.md)**: from a transcript line to a valid record, in four steps.
- **[docs/](docs/)**: four short guides: [keys and identity](docs/keys-and-identity.md),
  [implementing an adapter](docs/implementing-an-adapter.md),
  [consuming records](docs/consuming-records.md) and [conformance](docs/conformance.md).
- **[examples/](examples/)**: valid records, from one message to a full session, each with a README.

## Status

**sessions-model v1.1, sessions v1 (consumer pending).** The shape and every closed list are
frozen; additive optional fields and new registry values come in v1.x (v1.1 added the `ts_source`
value `legacy`), and a breaking change needs v2. One provider passes the conformance checklist; the
first consumer, memhouse, is moving onto it.

## Who implements it

| Role | Project |
|---|---|
| provider | [harness-skeleton](https://github.com/agent-realm/harness-skeleton): the session-adapters package (`packages/session-adapters`), one adapter per harness |
| storage | [sessions-sql](https://github.com/agent-realm/sessions-sql): the records as SQL tables (ClickHouse normative, PostgreSQL allowed) |
| consumer | memhouse: agent conversation memory |

## Using it

Cite a contract by name and version (`sessions-model@v1`), never copy it. An adapter claims
conformance when it passes the checklist at the end of each contract; the provider's conformance
matrix shows the result per harness.

## Contributing

Open an issue for a question or a proposed change, or send a pull request. [AGENTS.md](AGENTS.md)
has the rules agents follow.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
