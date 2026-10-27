# One session, one message

The smallest valid session: a `session` record and one user `message` with one `text` part.

- Every record carries the session key `(host, harness, harness_path, session_id, incarnation)` (sessions-model §1). `incarnation` is `''` because the harness never reuses ids (`reuse: impossible`).
- The session's `fingerprint.cmp_shas` lists its messages' `cmp_sha` values, in order.
- `setup` is `null`: the harness store records no setup.

**Validated.** Every record was sealed with `seal()` (its `cmp_sha` and `content_sha`) and each file passed `validateSession()`, both from the reference provider, `packages/harness-session-adapters` in [harness-skeleton](https://github.com/agent-realm/harness-skeleton), with 0 findings. `node generate.mjs <package dir> .` regenerates and re-validates them. Every value is synthetic: the `host` is the contract's own known-answer value, and no record comes from a real machine.
