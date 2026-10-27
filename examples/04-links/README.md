# Links: a fork and a sub-agent

Links state how one session derives from another (sessions-model §2.5). The other side is a **reference** that the consumer resolves.

- `fork-child.jsonl`: the child states its own fork (`stated_on: child`). `at` is the origin's message the fork was taken at, and `inherits` says what came along.
- `subagent-parent.jsonl`: the parent states the sub-agent it started (`stated_on: origin`). `at` is the spawning call's `call_id`. The child's incarnation is unknown here, so its reference leaves it out.

An adapter states only `explicit` links, ones the harness store records.

**Validated.** Every record was sealed with `seal()` (its `cmp_sha` and `content_sha`) and each file passed `validateSession()`, both from the reference provider, `packages/harness-session-adapters` in [harness-skeleton](https://github.com/agent-realm/harness-skeleton), with 0 findings. `node generate.mjs <package dir> .` regenerates and re-validates them. Every value is synthetic: the `host` is the contract's own known-answer value, and no record comes from a real machine.
