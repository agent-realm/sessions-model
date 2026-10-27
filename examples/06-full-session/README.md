# A full session

One session with most of the model in it:

- a title the harness set (`title_set_by: auto`);
- reasoning, two tool rounds (one failing, with `exit_code: 1`), and an `error` part (`error_kind`, `http_status`) beside the answer;
- a compaction: a `summary` part whose `replaces` names what it stands for, and a `lifecycle` record with `op: compaction`;
- one `per_response` usage record per response.

Compaction is not deletion: the replaced messages stay current.

**Validated.** Every record was sealed with `seal()` (its `cmp_sha` and `content_sha`) and each file passed `validateSession()`, both from the reference provider, `packages/harness-session-adapters` in [harness-skeleton](https://github.com/agent-realm/harness-skeleton), with 0 findings. `node generate.mjs <package dir> .` regenerates and re-validates them. Every value is synthetic: the `host` is the contract's own known-answer value, and no record comes from a real machine.
