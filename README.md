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
  observed on a lab machine. The conformance cases an adapter must pass are in sessions-model's
  checklist, against the provider's fixtures.

[TERMINOLOGY.md](TERMINOLOGY.md) is the vocabulary. Its *Sessions* section defines every term the
contracts use.

## Start here

- **[docs/tutorial.md](docs/tutorial.md)**: from a transcript line to a valid record, in four steps.
- **[docs/](docs/)**: four short guides: [keys and identity](docs/keys-and-identity.md),
  [implementing an adapter](docs/implementing-an-adapter.md),
  [consuming records](docs/consuming-records.md) and [conformance](docs/conformance.md).
- **[examples/](examples/)**: valid records, from one message to a full session, each with a README.

## Status

**sessions-model v1.3, sessions v1.3 (consumer pending).** The shape and every closed list are
frozen; additive optional fields, new registry values and opt-in features come in v1.x
(sessions-model v1.1 added the `ts_source` value `legacy`; sessions v1.1 added the `forget-notice`
feature; v1.3 settles `client`, `kind`, `is_error`, Zed's model and usage, a Devin sub-agent head,
retries that never resolve, and service-held harness stores such as claude.ai; there is no v1.2 of
the contracts, so that from v1.3 a contract version and its release tag agree, after the v1.2.0
release that carried v1.1), and a breaking change needs v2. One provider passes the v1 conformance checklist; the
first consumer, memhouse, is moving onto it. The `forget-notice` feature has no provider or consumer
yet.

## Who implements it

| Role | Project |
|---|---|
| provider | [harness-skeleton](https://github.com/agent-realm/harness-skeleton): the session-adapters package (`packages/session-adapters`), one adapter per harness |
| storage | [harness-sessions-sql](https://github.com/agent-realm/harness-sessions-sql): the records as SQL tables (ClickHouse normative, PostgreSQL allowed) |
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
