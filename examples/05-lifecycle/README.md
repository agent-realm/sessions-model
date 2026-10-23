# Lifecycle: retraction and destruction

The same rewind, recorded the two ways harness stores do it (sessions-model §2.6).

- `retraction.jsonl`, append-only: the rewound message stays, with `state: retracted`, and a `lifecycle` record names it. Nothing is tombstoned.
- `destructive.jsonl`, rewritten: the store deleted the rewound messages (`m-0002`, `m-0003` are absent), and the `lifecycle` record names the removed range. A consumer drops those keys when they leave `live`.

Lifecycle records are `explicit` only: they exist for operations the harness store itself records.

**Validated.** Every record was sealed with `seal()` (its `cmp_sha` and `content_sha`) and each file passed `validateSession()`, both from the reference provider, `packages/session-adapters` in [harness-skeleton](https://github.com/agent-realm/harness-skeleton), with 0 findings. `node generate.mjs <package dir> .` regenerates and re-validates them. Every value is synthetic: the `host` is the contract's own known-answer value, and no record comes from a real machine.
