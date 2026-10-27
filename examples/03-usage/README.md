# Usage, and the two flags

Two sessions from two harnesses whose vendors count tokens differently (sessions-model §2.4).

- `claude-code.jsonl`: cached input is reported **beside** `input` (`input_includes_cache: false`), and reasoning is counted **inside** `output` (`output_includes_reasoning: true`). Total input = 12 + 2000 + 150.
- `gemini-cli.jsonl`: cached input is **inside** `input` (`true`), reasoning is **beside** `output` (`false`), and `tool_prompt` is input counted apart from both. Total input = 900 + 80; total output = 30 + 25.

Each usage record is anchored to its response (`{response_id}`) with `granularity: per_response`, so a consumer counts it once. The adapter copies the stored numbers and never converts them.

**Validated.** Every record was sealed with `seal()` (its `cmp_sha` and `content_sha`) and each file passed `validateSession()`, both from the reference provider, `packages/harness-session-adapters` in [harness-skeleton](https://github.com/agent-realm/harness-skeleton), with 0 findings. `node generate.mjs <package dir> .` regenerates and re-validates them. Every value is synthetic: the `host` is the contract's own known-answer value, and no record comes from a real machine.
