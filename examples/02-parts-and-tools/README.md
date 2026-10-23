# Parts and a tool call

A user turn, then an assistant message with a `reasoning` part and a `tool_call`, the tool's result as a `tool` message with a `tool_result` part, and the final answer.

- The `tool_call` and its `tool_result` share one `call_id` (tool linkage, sessions-model §2.3).
- `exit_code` sits beside the output, not inside it; it is `null` where the harness store keeps none.
- `parent_id` chains the turns, while `order` alone decides the order of messages.

**Validated.** Every record was sealed with `seal()` (its `cmp_sha` and `content_sha`) and each file passed `validateSession()`, both from the reference provider, `packages/session-adapters` in [harness-skeleton](https://github.com/agent-realm/harness-skeleton), with 0 findings. `node generate.mjs <package dir> .` regenerates and re-validates them. Every value is synthetic: the `host` is the contract's own known-answer value, and no record comes from a real machine.
