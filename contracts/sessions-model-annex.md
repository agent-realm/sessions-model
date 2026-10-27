# Annex to sessions-model v1.3: mapping per harness and conformance cases

**status:** informative, not normative. The normative text is [sessions-model](sessions-model.md).

This annex was extracted on 2026-10-22 from lab findings that are not published:
- adapter specs for copilot-cli, cursor-agent, agy, opencode, goose, gemini-cli, commandcode and droid;
- notes on VS Code 1.142 (Local and Copilot engines), Cursor IDE 3.25.9, Windsurf/Devin 3.10.67 and Zed 1.24.3;
- earlier source-identity work, for claude-code and codex.

Everything was observed with synthetic sessions on a lab VM.

Conventions:
- `?` means the sources do not say.
- `(fx)` means the fact was read from a fixture rather than from spec text.
- `[HS …]` cites harness-skeleton's surveys (`docs/design/surveys/<harness>-2026-10-04.md`).
  Those were read from docs on Claude Code 2.1.289, Codex 0.160.0, OpenCode 1.18.18 and pi
  0.80.2, from harness-skeleton's surveys. None of them was seen on a
  bench.
- `S` means source-only (vendor code).
- `R` means droid's own serialiser wrote the record from synthetic content.
- "basis ?" with numbers means the basis is not stated, and the numbers are what the fixture
  shows. sessions-model §2.4 has since split a basis into two flags, `input_includes_cache` and
  `output_includes_reasoning`, and its table, not the usage column here, gives each harness's
  values.

---

## 1. Mapping table

| harness | harness store | session_id (native) | reuse | birth marker | incarnation marker | message_id | part split | order key | ts | tool call↔result | sub-agent link | fork link | rewind/edit evidence | compaction | usage (location; basis; granularity) | model / effort | position kind | reset triggers | hook join | secrets to redact |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | append-only JSONL; main and sub-agent files | native id, unprefixed | impossible (uuid) | — | ? (capture only: inode, an anchor and a prefix hash) | record `uuid` (+`part`) | content blocks | `ts`, then capture order, `part` | record `timestamp` | `tool_use.id` = `call_id`; call row re-emitted with original ts on result | own file within the parent session; `agent_id` | ? | ? (verbatim re-appended user records: same uuid, same ts) | ? | first record of each `message.id`; open unit whose usage grows → re-emit; basis ?; per_response | `message.model`; record `effort` | `byte_offset` (inode; anchor and prefix sha as reset evidence) | shorter than the last position, anchor or prefix mismatch, inode change → a new generation | yes (docs): hook stdin `session_id`; `transcript_path` = `<session-id>.jsonl`; sub-agent hooks add `agent_id`/`agent_type` → join (session, agent_id); sub-agent `session_id` = parent untested [HS CC §9, §11, §13, §16] | ? |
| codex | append-only JSONL rollouts | native id, unprefixed | impossible (uuid) | — | ? (capture only) | `payload.id`, else `<rollout file name>@<byte offset>` (ids partial) | ? | `ts`, capture order | record `timestamp` (a pre-adapter consumer interpolated it: `ts_source: legacy`) | `call_id` | ? | ? | ? | ? | Σ `last_token_usage` of the turn's `token_count` events on its first assistant row, else a `kind=usage` row; running totals skipped; basis ?; per_turn (`response_id` = turn id) | `turn_context.model`, `.effort` | `byte_offset` | as claude-code (no non-append change seen for JSONL) | probably (docs, untested): hook stdin `session_id`, `transcript_path` (may be null), `turn_id`; `session_meta` has both `id` and `session_id`, which one hooks send is untested; join on `transcript_path` when non-null [HS CX §11, §16, §19] | ? |
| copilot-cli | `~/.copilot/session-state/<sid>/events.jsonl`, append-only (+`workspace.yaml`; `session-store.db` is an index only) | dir name = `session.start.data.sessionId` | detected | `session.start` event `id` (uuid); fixture `copilot-cli/conformance-copilot-reuse/` (harness-skeleton) | `session.start` event `id` (+`startTime`); changes when a deleted id is reused | event `id` (uuid4); also `data.messageId` | `assistant.message` content, `reasoningText`, `toolRequests[]`; results are separate `tool.execution_*` events; `attachments` + `session.binary_asset` | line position (`parentId` is only a hint) | event `timestamp` (ISO Z) | `toolRequests[].toolCallId` = `tool.execution_complete.toolCallId` | same file: envelope `agentId` + `parentToolCallId` = `task` call | new dir, same event ids; `session.info{infoType:fork}` on both sides, naming the other sid in text | file rewritten (new inode, shorter) + appended `session.info{rewind}`; edit = rewind + resend with new ids | `compaction_start/complete` appended (`messagesRemoved` count, `summaryContent`); nothing removed | `session.usage_record` per API call, joined by `apiCallId`; basis ?; per_response; cost 0 under BYOK | `assistant.message.model`; served = `usage.modelDisplayName`; `reasoningEffort` (model_change, usage, `subagent.configured`) | `byte_offset` (first-line id + prefix sha as reset evidence) | new inode or shorter file (rewind); new `session.start` id (reuse) | yes for root (`input.sessionId` = sid); sub-agent hooks carry `agentId` as `sessionId` (fx) | ? (none named in records) |
| vscode (engine local) | `workspaceStorage/<ws>/chatSessions/<sid>.jsonl`, change log `kind 0/1/2`, append-only; writes lag the UI ≤ ~2 min | `<sid>` (= `state.sessionId`) | impossible (uuid) | — | ? | user: `requestId` (`request_<uuid>`; bare uuid after a fork); assistant: `responseId` (fallback `<requestId>:response`) | user `message.text`; `response[]` by `kind` (markdown, thinking, toolInvocationSerialized, textEditGroup, …) | fold order of `requests[]` | request `timestamp` ms (fork: reset to fork time + 1 ms each) | one `toolInvocationSerialized` part (`toolCallId`) holds call and result | same request; `subAgentInvocationId` on the sub-agent's calls; its prompt is a plain user message | none (new ids, new ts, one `kind 0` snapshot) | `kind 2` with `i` truncates later requests, written at the next send | a request whose metadata holds the summary; earlier turns stay | per request `promptTokens`, `completionTokens`, `copilotCredits`; basis ?; per_turn | `modelId` = `copilot/auto`; served = `autoModeResolution.resolved` / `result.metadata.resolvedModel`; effort ? | `byte_offset` (the change log is append-only; the fold is derive state) | ? (UNVERIFIED whether a log collapses to one `kind 0` on reload) | ? | `auth` key in selected-model metadata (redacted by name in fx; content ?) |
| copilot-cli (client vscode, VS Code Copilot engine) | Copilot CLI `events.jsonl` (`client_name: vscode-agent-host`) + `agentSessionData/<vsSid>/session.db` | `sdkSessionId` (dir); VS Code `vsSid` via `session_metadata.defaultChatProviderData.sdkSessionId` | as copilot-cli (harness `copilot-cli`, client `vscode`) | as copilot-cli | as copilot-cli | event `id`; `session.db turns.id` = `request_<uuid>` ↔ `event_id` | as copilot-cli | line position | event `timestamp` | as copilot-cli | ? (format as copilot-cli; not observed from VS Code) | new CLI dir with the same event ids + parent `session.info` fork; agent-host.db `session_chats.origin{kind:fork}` + `inherited_turn_id` (fx) | `events.jsonl` rewritten shorter (new inode); `file_edits` row deleted | not tried | `session.db turn_usage` (tokens, the model Auto picked, `cost`); basis ?; last call vs turn total UNVERIFIED | `turn_usage` model; `session.auto_mode_resolved.chosenModel` | as copilot-cli; `agentSessionData` session.db side source: `rowid` + `known` | as copilot-cli | yes to the sdk sid, not to `vsSid` (fx) | ? |
| cursor | global `state.vscdb`: `composerHeaders` + `cursorDiskKV` (`composerData:`, `bubbleId:`), upserted in place; + append-only agent-transcripts JSONL | `composerId` | impossible (uuid) | — | ? | user: `bubbleId`; assistant: `<bubbleId>:assistant`, with children `/s:<n>` and `/t:<toolCallId>` as parts (`part_id` = the child suffix); the id does not pin content | children of the user bubble: `/s:n` text or thinking (capabilityType 30), `/t:` tool | `composerData.fullConversationHeadersOnly` (lists the children too) | bubble `createdAt` ISO; headers `startedAtMs/completedAtMs` | one `/t:` bubble: `toolFormerData{toolCallId, params, status, result{output, exitCode}}` | `composerHeaders.isSubagent`, `subagentComposerIds` (not exercised) | none: new composerId `(1) <name>`, identical bubbleIds | user bubble rewritten in place (same id), later bubbles hard-deleted | not exercised | `tokenCount` {0,0} and `usageData` {} (free plan); only `contextTokensUsed` | user bubble `modelInfo.modelName`; effort in `modelConfig.selectedModels[].parameters` | `kv` + `known` (per-bubble sha); composerHeaders `rowid` | any in-place rewrite or delete; rename does not bump `lastUpdatedAt` | ? | `composerData.blobEncryptionKey`, `speculativeSummarizationEncryptionKey`; ItemTable `cursorAuth/*` |
| cursor-agent | `~/.cursor/chats/<md5(cwd)>/<chatId>/store.db`: immutable sha256 blobs + `meta` row; transcript JSONL is regenerated | chatId = `meta.agentId` = dir | impossible (uuid) | — | ? (only stamp: meta `createdAt`) | UserMessage `message_id`; turn `request_id`; JSON `msg_…`; blob sha256 | turn `steps[]`: assistant_message \| thinking_message \| tool_call (args + result) | root `#8` turns, then `steps[]`; root `#1` = model context | `started_at_ms` / `completed_at_ms` (user message, steps, tools) | step `tool_call_id` = JSON part `toolCallId` = tool message `id` (contains `\n`) | own `store.db`; meta `subagentInfo{parentAgentId, rootParentAgentId, toolCallId, typeName}` | none: blobs copied, same root, `(forked)`, new `createdAt` | `latestRootBlobId` ← chosen turn's `conversation_state_blob_id`; later turns orphaned | new root with `summary` + `summary_archives[]` (the replaced JSON blobs); turns kept | none stored (root `token_details` is a context gauge); headless stdout only | JSON part `providerOptions.cursor.modelName`; effort only inside parameterized model ids | `kv` over the immutable `blobs` table + `known`; the `meta` row as `snapshot` | none: a root change (a rewind, a stale concurrent writer) is a `snapshot` change of `meta`, never a reset; a fork is a new directory | ? | meta `blobEncryptionKey`; `cli-config.json` authInfo; `auth.json`; turn `encrypted_model` (opaque) |
| agy | `conversations/<cascade>.db` (protobuf rows, WAL) + append-only `brain/<id>/…/transcript_full.jsonl` | cascade id | impossible (uuid; not reused after delete, observed) | — | not reused after delete; new on fork, `/clear` and every `-p` | `metadata.model_api_content_id` (32-hex), from the DB; the jsonl has no ids | planner: response, thinking, `tool_calls[]`; GENERIC: one tool_result | `idx` (jsonl: `step_index`; a non-increasing index truncates) | `metadata.created_at` (ns); jsonl seconds | planner `tool_calls[].id` (`call_N`) = GENERIC `metadata.tool_call.id`; jsonl by position only | own cascade; `trajectory_metadata_blob.parent_conversation_id`, `nesting_depth`; `invoke_subagent` result | `parent_references` (FORK, conversation_id, step_index); copied steps keep the origin `cascade_id` | DB rows hard-deleted, idx reused; jsonl keeps the lines | CHECKPOINT step (`included_step_index_end`) | `gen_metadata.chat_model.usage` per generation; planner `metadata.model_usage`; basis ?; per_response | `gen_metadata response_model` / `model_display_name`; effort folded into the model enum | DB: `rowid` + `known` (idx is reused); summaries: `time_updated+id`; jsonl side source: `byte_offset` | idx reuse (content id changes at an idx) | yes: `conversationId` = cascade, `stepIdx` (fx) | `antigravity-oauth-token`, `jetski-standalone-oauth-token` files |
| opencode (v1 engine) | `opencode.db` SQLite WAL: `session`, `message`, `part` (+`event` log) | `session.id` (`ses_…`) | impossible (`ses_` time + random); import restores the same session | — | ? (ids never reused; import restores old ids) | `message.id` (`msg_…`); `part.id` (`prt_…`) | `part` rows, 12 types | `(time_created, id)`; parts by id | `data.time.created/completed` ms | one `tool` part (`callID`, `state.input` → `state.output`) | child `session.parent_id`; parent `task` part `state.metadata.sessionId` | none: new ids keeping the source `time_created`, `(fork #N)` | `session.revert` (rows kept); prompting while reverted hard-deletes + `message.removed` events | `compaction` part {auto, overflow, tail_start_id} + summary assistant (`summary:true`); nothing deleted | `step-finish` tokens/cost copied onto the assistant message; net (`input` excludes cache.read, `output` excludes reasoning); per_message (one per LLM step) | assistant `providerID` + `modelID`; effort = `variant` | `time_updated+id` + `known` (`PRAGMA data_version` as a cheap change probe) | deletes, import (same ids, no events), migration that wipes `event` | yes, via plugin (docs): `sessionID` = `session.id`; `callID` on `tool.execute.before/after` = tool part `callID`; `messageID` on `chat.message`; sub-agent hooks carry the child id (untested) [HS OC §11, §16] | tables `account`, `account_state`, `control_account`, `credential`, `session_share` (never read) |
| opencode (v2 engine) | same DB: `session_message`, `session_input`, `session_context_epoch`, `session.next.*` events | `session.id` | impossible | — | ? | `session_message.id`; part = content `id` (local, e.g. `text-0`) | assistant `content[]`: text \| reasoning \| tool | `seq` (= seq of the creating event) | `time_created`; content `time` | tool content element (`id` = callID) holds both | ? | ? | `session.next.revert.staged/committed` (commit deleted the assistant row) | source-only `compaction{reason, summary, recent}` | `tokens` on the assistant record; basis ?; per_message | `model{id, providerID, variant}` | `session_message`: `time_updated+id` + `known` (the table has `time_created` and `time_updated` columns; rows are upserted, and a revert commit deletes one); `session.next.*` events: `seq` | ? | as v1 (docs) [HS OC §11, §16] | as v1 |
| goose | `sessions.db` SQLite WAL: `sessions`, `messages`, `usage_ledger` | `sessions.id` `YYYYMMDD_N` (UTC date) | undetectable (weak marker) | `created_at`, second resolution: not discriminating; incarnation = `created_at` within the harness store | `created_at` (reuse undetectable; created_at alone is not discriminating; the harness store is part of the key) | `messages.message_id` (provider id or `msg_<uuid>`); never `messages.id` | `content_json[]` elements | `(created_timestamp, id)` | `created_timestamp` epoch seconds | `toolRequest.id` = `toolResponse.id` (the result row has role user) | `sessions.parent_session_id` (type `sub_agent`); parent `foreground_subagent.delivered` | none: rows copied with `message_id` + `created_timestamp`; ACP name `(copy)` | `--edit` deletes and re-inserts (new rowids); ACP truncate deletes rows ≥ T | summary row (role user, U=0 A=1); earlier rows flipped `agentVisible=false` in place; ledger `is_compaction=1` | `usage_ledger` per call (authoritative) + `metadata.usage` per assistant row; basis ? (fx: total = input+output, cacheRead ≤ input); per_response | row `inference.requestedModel`; served = ledger `model`; effort per session `request_params.thinking_effort` | `rowid` + `known` (in-place `agentVisible` flips; rowids re-minted on `--edit`) | row-count drop, metadata flip, `created_at` change, re-insert | ? | `extension_data` extension `envs` |
| gemini-cli | `~/.gemini/tmp/<slug>/chats/session-<ts>-<sid8>.jsonl`, append-only, event-sourced | header `sessionId` | impossible (uuid) | — | ? | record `id` (rewritten with last-wins; fixed id for the injected session_context) | `content[]`, `toolCalls[]` (+`result[]`), `thoughts[]` | file order after the fold | record `timestamp` | `toolCalls[i].id` = `functionResponse.id` | `chats/<parent>/<child>.jsonl`, kind subagent (S) | none (`/chat save` + resume copies into a new id) | `$rewindTo` (tail), `$patch{removeIds, updates}` | ? (UNVERIFIED) | per gemini record `tokens{input, output, cached, thoughts, tool, total}`; basis ? (fx: total = input+output, cached ≤ input); per_response | record `model` (requested id); no effort field | `byte_offset` (dev, inode, size as reset evidence; `$set`/`$patch`/`$rewindTo` folded in derive state) | inode change (temp + rename rewrite) or shrink | ? | checkpoint `authType` |
| commandcode | `~/.commandcode/projects/<slug>/<uuid>.jsonl`, v3 entry tree, append-only (+`meta.json`, checkpoints) | filename uuid (on a fork the header `id` is the parent's) | impossible (uuid filename) | — | ? | entry `id` (8 hex) + `meta.messageId` | Anthropic content blocks | file order; active branch = `parentId` walk from the last entry | entry `timestamp` = flush time; `meta.createdAt` = typed time | `tool_use.id` = `tool_result.tool_use_id` (no `is_error`) | none stored (parent `tool_result` only) | meta `parentSessionId`, `forkedAt`; copied lines carry `sessionId:<new>`; clone: header `parentSession` | sibling branch (`parentId` = target); the transcript is never rewritten | `compaction{summary, firstKeptEntryId, tokensBefore}`; pruning-only → meta only | assistant `usage` per model request; basis ? (fx: cacheRead ≤ input); per_response; `costUsd` S | assistant `model`, `effort`; `model_change` / `effort_change` entries | `byte_offset` | inode change or shrink (v1/v2 migration) | audit file `hooks-audit-<sid>.jsonl` keyed by sid; stdin payload ? | ? (none named in records) |
| droid | `~/.factory/sessions/<projectKey>/<sid>.jsonl`, append-only (line 1 rewritten in place) + `<sid>.settings.json` | `session_start.id` = file stem | impossible (uuid) | — | ? (the line-1 rewrite is not one) | `message.id` (uuid, `context-<uuid>`, caller strings) | content blocks (snake_case) | `seq` (lines without seq: file position) | `timestamp` = writer clock at append | `tool_use.id` = `tool_result.tool_use_id` (R) | child `session_start.callingSessionId` + `callingToolUseId` (S) | `session_start.parent` + `forkedAtMessageId`; copies keep id, ts and seq | new session file truncated before the chosen message; settings tag `rewind{rewoundFromSessionId}` | `compaction_state{anchorMessage{id,index}, removedCount, summaryKind}` | settings `tokenUsage` cumulative (+`inclusiveTokenUsage` with children); basis ?; per_session; per-message `tokens` S | assistant `modelId`, `reasoningEffort` (R); settings hold current values | `byte_offset` (line-1 length **and sha** as reset evidence) | line-1 length or sha change; inode change (org-claim rewrite) | ? (hook records sit in the transcript, `hookParentId`) | `auth.v2.keyring` file |
| devin | `~/.local/share/devin/cli/sessions.db` SQLite WAL: node tree `message_nodes` | `sessions.id` (two-word slug) | undetectable (two-word slug; reuse unverified) | none: the row `created_at` resets on every save | `''` (reuse undetectable; no marker) | `chat_message.message_id`; `node_id` = stable position; never `row_id` | `content`, `tool_calls[]`, `thinking`, `images` | walk `main_chain_id` → `parent_node_id`, dedupe by message_id | `chat_message.metadata.created_at` (RFC 3339; the row's `created_at` resets on every save) | assistant `tool_calls[].id` = tool node `tool_call_id`; one `tool_call_state` row per call | same tree; parent tool result `subagent/agent_id`, `subagent/chain_node_id` | new slug, same node_ids and message_ids; hidden summary-agent session + summary `.md` | `main_chain_id` moves back; edit = revert + sibling branch | summarizer chain; `<summary>` node `summarized_from`; continuation node | per message `metadata.metrics{input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens}`; basis ? (numbers fit either); per_response | `generation_model` per message; effort ? | `snapshot` (the node tree; walk `main_chain_id`) | every turn (all nodes deleted and re-inserted) | ? | ? |
| zed | `~/.local/share/zed/threads/threads.db`: one zstd JSON blob per thread, rewritten per update | `threads.id` | impossible (uuid, fx) | — | ? | User `id` (fx); assistant messages anchored `<user id>+n` | `content[]` (Text \| ToolUse) + `tool_results{id}`; `reasoning_details` | array position | none per message (row `created_at` / `updated_at`) | `ToolUse.id` = `tool_results` key | child row `parent_id`; `subagent_context{parent_thread_id, depth}` | ? | restore checkpoint truncates `messages[]` in place | ? (`detailed_summary` field) | `cumulative_token_usage` per thread + `request_token_usage` keyed by User id (fx); basis ? (numbers fit either); per_turn / per_session | thread `model{provider, model}`, `thinking_effort` | `snapshot` (the thread blob) | every update; truncation | ? | ? (none in the harness store; the key comes from env or keyring) |
| pi (docs only; not on the VM) | `<agent-dir>/sessions/--<encoded cwd>--/<ts>_<uuid>.jsonl`; override `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > `sessionDir` | header `id` (uuid); equals the filename uuid: untested | impossible (uuid, docs) | — | ? | entry `id` | ? | file order; tree via `parentId` (`/tree` branches in-file → `on_active_branch`) | header `timestamp`; entries ? | ? | ? | `--fork`, `/fork`, `/clone` make new files (inferred) | in-file branches | `compaction` and branch-summary entries | ? | ? | `byte_offset` | v1/v2 auto-migration (presumably a rewrite → reset) | yes, via extension (docs): `ctx.sessionManager`; from 0.82.0 shell tools get `PI_SESSION_ID`, `PI_SESSION_FILE`; equality with header `id` untested | ? |

---

## 2. Model gaps per harness

These gaps were recorded against an earlier draft of this model. Items now covered by sessions-model
(aliases, `state: reverted`, session `kind`, `ts_source`, two visibility flags, nullable usage,
anchored ids) are kept as the record of why those fields exist.

### claude-code
- A response's usage grows across records of one `message.id`. Usage must be revisable on an open unit (re-emit at a higher rev), not written once.
- Verbatim re-appended user records (same `uuid`, same ts) must collapse. The model must tolerate an exact duplicate of a native id.
- The sources name no native incarnation marker, fork, rewind, compaction or hook join. A capture-level generation is the only reset concept.

### codex
- Native ids are partial. `@<byte offset>` is stable only because rollouts are append-only. A positional fallback would break on any rewrite.
- A turn that produced no assistant text still has tokens (`kind = 'usage'` row). Usage must be able to exist without a message.
- The billing unit is the turn (`response_id` = turn id), not a response. So `granularity` must be per harness, not global.

### copilot-cli
- Two native ids per message: event `id` and `data.messageId`, plus `interactionId` and a `turnId` that restarts at "0" per prompt. The model has one `message_id` and no alias.
- `parentId` is "chronologically preceding", not a tree. `model.*` side chains point at ids that are not in the file. `parent_id` cannot be trusted.
- Compaction gives counts (`messagesRemoved` 12 of 13), not an id range. `summary{replaces range}` cannot be filled from ids.
- A turn cut off by the output cap leaves a `usage_record` (`finishReason: length`) with no `assistant.message`. That is usage with no message.
- Rewind rewrites the file but leaves the rewound prompt's hook events. Evidence is partly destructive and partly explicit.
- The fork link is free text (`session.info.message` names the other sid), so a parser is needed.
- Sub-agent hook payloads put the sub-agent's `agentId` in `sessionId`. A hook join needs (session, agent_id).

### vscode (engine local)
- The session is a fold of a change log. Response parts have no ids, only array indices.
- An edit or restore is visible only at the next send, as a truncating splice. There is no "edit" record, only `kind 2` with `i`.
- A fork mints new ids and resets timestamps (fork time + 1 ms each), with no link. Only a content match can recover it.
- "Thinking" parts are empty, with an opaque id: a reasoning part with no text.
- `modelId` is `copilot/auto`. The served model is elsewhere (`autoModeResolution`).
- Usage includes `copilotCredits` (not tokens). `result.metadata.outputTokens` (102) disagrees with `completionTokens` (1,258).
- A sub-agent's prompt is stored as an ordinary user message, with no `source` marker.
- A side transcript (`GitHub.copilot-chat/transcripts/<sid>.jsonl`) keeps dropped turns. That makes two files holding one session.

### copilot-cli (client vscode)
- Two session ids (`vsSid`, `sdkSessionId`). Title, real model and cost live only in `session.db`. The session needs alias ids and a join with `session.db`.
- client ≠ harness: a `vscode-agent-host` client writes into a Copilot CLI harness store. The `client` field must be per session, not per harness.
- The fork link (`session_chats.origin{kind:fork}`, `inherited_turn_id` = an event id) exists only in `agent-host.db`, which is fixture-only and not described in the doc text.
- Whether `turn_usage` is the last call or the turn total is UNVERIFIED, so granularity is unknown.

### cursor
- `(composerId, bubbleId)` does not pin content: an edit rewrites in place and a fork shares bubble ids. The model needs a content hash or revision per message.
- The assistant reply has no message id of its own. It is the children of the user bubble, so parts hang off a turn.
- Tool call ids contain a newline. ids must be byte-exact strings.
- Usage is `{0,0}` everywhere on the free plan, and only a context gauge exists. A zero must mean unknown, not zero.
- Rename does not bump `lastUpdatedAt`, so change detection needs a name compare.
- It shares `agent-transcripts/` with cursor-agent, so client attribution depends on whether a `store.db` exists.

### cursor-agent
- The current conversation is a blob tree under a moving root. Rewind and fork move it backwards, so "rewound" must stay distinct from "deleted".
- Turn blobs are re-minted as steps arrive. A turn is a revision series keyed by `request_id`.
- There are two views with different ids: UI turns (`request_id`, `message_id`) and the model-context JSON (`msg_…`, blob sha).
- No usage is stored at all, so `usage` must be optional per session.
- Effort is embedded in parameterized model ids (`name[…reasoning_effort=…]`), not a field.
- A refused prompt leaves an empty root and an auto-title but no user message: a titled session with zero messages.
- Concurrent sessions are last-writer-wins on the meta row, which can hide the other session's turns.

### agy
- The message key (`model_api_content_id`) exists only in the DB. The jsonl has no message or tool ids and links tools by position.
- `idx` is reused after a rewind, so (cascade, idx) is a position, not an identity.
- Fork copies keep the origin `cascade_id` per step. Origin is a per-message attribute, not only a session-level link.
- Statuses beyond the model: WAITING (9), QUEUED, RUNNING forever in the jsonl, CANCELED never in the jsonl.
- Effort is folded into the numeric model enum (M417/M418/M419). The model needs a `gen_metadata` join.
- A background task's completion arrives later as a SYSTEM_MESSAGE from a task sender: a tool result decoupled from its call.
- Messages between parent and sub-agent arrive as SYSTEM_MESSAGE `agent_message`. That is cross-session message delivery.
- Delete does not cascade to sub-agents, so orphan child sessions remain.

### opencode (v1)
- A fork has no link and new ids. The only signal is an id-embedded time later than `time_created`, plus a content hash, so the link is always inferred.
- The `session.revert` state hides messages without deleting them: a per-message "reverted" state the model lacks.
- The edit evidence (`message.removed` events) lives in a table that is deleted with the session or wiped by a migration.
- One `tool` part holds both call and result. The model's separate tool_call and tool_result parts must share one native part id.
- `step-start`, `step-finish`, `patch` and `snapshot` parts have no model kind.
- Overflow compaction re-inserts the original user text as a new, non-synthetic message: a duplicate prompt.
- An assistant row with no `completed`, `finish` or `error` may dangle forever. An aborted step stores all-zero tokens.
- Import restores the same ids, with `time_updated` = import time and no events.

### opencode (v2)
- Content element ids are local (`text-0`), so a part key is (message id, content id).
- `session_input` has `delivery` steer|queue with `admitted_seq` and `promoted_seq`: a queued or steered prompt lifecycle with no model slot.
- Revert is two-phase (`staged`, then `committed`).
- Compaction kinds are source-only, and deltas are never stored. Which clients use v2 is UNVERIFIED.

### goose
- `sessions.id` is reused after a delete, and `created_at` (second resolution) does not discriminate a same-second recreate: `reuse = undetectable`, incarnation `created_at` (the harness store is already part of the session key).
- Compaction flips earlier rows to `agentVisible=false` in place. Visibility changes after the fact, and the summary row has role user.
- `message_id` is not unique across sessions: fork, edit and import copy it.
- An elicitation response is inserted before its request, with the same second-precision timestamp, so the order key is not causal.
- Usage is authoritative in the ledger, per call, including compaction. The auto-title call is in neither messages nor the ledger.
- Tool results are `role: user` rows, with parallel results in completion order.
- Effort is per session only. There are session types `hidden`, `terminal` and `scheduled` that the model has no field for.

### gemini-cli
- The same record id is rewritten (toolCalls added), last wins: a message has revisions.
- `$patch` edits earlier content by id. `$rewindTo X` truncates the tail from X on, X included (the CLI's rewindTo() removes "all messages from (and including) the specified ID onwards", and clears everything when X is not held). Both are explicit ops that the fold must apply.
- The injected session_context uses one fixed id in every session and cwd, so ids are only unique within a session.
- Tool call and result sit inside the gemini record and are also echoed as a user `functionResponse` record: a duplicate representation.
- There are no parent ids. Compaction shape is UNVERIFIED and sub-agents are source-only.
- `logs.json` is shared per project, with last-writer-wins.

### commandcode
- The session id is the filename. The header `id` differs on forks, so the session needs an alias.
- The file is a tree with abandoned branches. The model needs `on_active_branch` or a branch id.
- There is no `is_error`: failures exist only in text, and harness errors are `role: user` with no `source`.
- Sub-agent transcripts are never saved, so a sub-agent link has no target session.
- A user entry's `timestamp` is the flush time; the real time is `meta.createdAt`. ts needs a declared source.
- The v1/v2 → v3 migration rewrites the file (new inode) with fresh random entry ids and re-appended duplicates. ids are not stable across that rewrite, even though it is not a new incarnation.
- A pruning-only `/compact` writes no entry, only `meta.compaction`.

### droid
- Hook records can precede their target (`hookParentId` forward reference).
- `agent_turn_outcome` and `compaction_state` have no `seq`, and the outcome has no id or timestamp. Order comes from file position, and the turn status attaches to another record by `turnId`.
- Line 1 is rewritten in place with the mtime restored: a header revision that shifts byte offsets without a new incarnation.
- A rewind is a new session file (rewind_copy), and its at-message can be an `llm_only` context record, not a user message.
- Concurrent writers branch `parentId` off the same parent.
- Usage is only cumulative in a settings sidecar (+ inclusive of children). Per-message `tokens` is source-only.
- Assistant model fields are R or S only, because no real reply was observed (402).

### devin
- Every turn deletes and re-inserts every node, so `row_id` and row `created_at` are useless. Only `message_id` and `node_id` are stable.
- Streaming twins: two sibling nodes carry the same `message_id`.
- A mode switch copies the whole chain under a new root inside the same session (prefix copies with `compact/prior_node_ids`): copies within one session.
- Abandoned branches remain after a revert, so the model needs an active-branch notion.
- Archive state lives in another harness store (Devin Desktop's globalStorage). A fork also spawns a hidden summary-agent session.
- The sub-agent chain lives in the same tree. The link is in a tool result's metadata.

### zed
- Whole-thread rewrite with no Agent message ids and no per-message timestamps. Assistant messages are anchored to the preceding User `id` (`<user id>+n`), and ts falls back to first-seen.
- User messages do carry an `id` (fx), and `request_token_usage` is keyed by it.
- Restore checkpoint truncates in place. Rewind evidence is only implicit.
  - Observed 2026-10-23 (Zed 1.24.3, a lab VM, fixture `zed/restore-lab/`): "Restore Checkpoint" on a user message removes that message too, not only what follows it. A thread restored at its first message is empty, and its next message regrows it under a new user id. The thread keeps no checkpoint field. `request_token_usage` is cleared, `cumulative_token_usage` is not reduced, and neither the row's nor the sidebar's `updated_at` moves until the regrow.
- `request_token_usage` values do not sum to `cumulative_token_usage` (fx: 12,135 vs 130,477 input). The per-turn value is not a turn total.
- Archive state lives in another DB (`sidebar_threads.archived`).
- A failing command (exit 3) has `is_error: false`, so the failure is only in the text.

---

## 3. Conformance cases

The cases observed in the lab are not published with their source files. The conformance
checklist in [sessions-model](sessions-model.md) states the cases an adapter must pass, against
the session-adapters package's fixtures in
[harness-skeleton](https://github.com/agent-realm/harness-skeleton)
(`packages/session-adapters/fixtures/<harness>/<case>/`).

---

## 4. Cross-harness observations that should shape the model

1. **Fork copies usually keep the native ids.** Same ids in copilot-cli, copilot-cli (client vscode), cursor, cursor-agent, agy, goose, commandcode, droid and devin. New ids in opencode and vscode (local). So the key must include the session, and a fork link needs an inherited range with a "copied ids preserved" flag and "do not bill twice" accounting. Copilot copies `usage_record`s, CLI goose copies `accumulated_*`, and droid's settings drop `tokenUsage`.
2. **Explicit fork links are rare.** They exist in agy (`parent_references`), droid (`parent` + `forkedAtMessageId`), commandcode (`parentSessionId`), copilot (text in `session.info`) and copilot-cli (client vscode) (`agent-host.db origin`). Everything else is inferred from shared ids, id-time vs `time_created` (opencode) or content. A link needs `evidence: explicit | inferred`.
3. **Rewind takes four forms.**
   - Append-only retraction ops: gemini, vscode (local), commandcode branch, agy jsonl.
   - Destructive rewrite or delete: copilot, opencode, agy DB, cursor, goose, zed.
   - A pointer move: cursor-agent root, devin `main_chain_id`.
   - A new copy session: droid.

   Messages need a state of current vs superseded-but-recoverable vs deleted, and branch-aware harnesses (commandcode, devin, droid concurrent writers) need an active-branch flag.
4. **Storage positions are not identities.** agy reuses `idx`, goose re-mints `messages.id` on `--edit`, devin changes `row_id` every turn, cursor-agent `rowid` changes on re-insert, and zed has only array positions. Each of these except zed has a stable native id: `model_api_content_id`, `message_id`, `message_id`/`node_id`, and `request_id`/blob sha. `@<position>` must be the last resort (codex is safe only because it is append-only).
5. **A native id can repeat within one session.** gemini rewrites with last-wins, devin has streaming twins and prefix copies, cursor keeps `bubbleId` with new text on edit, cursor-agent re-mints turn blobs, commandcode re-appends after migration, and claude-code re-appends verbatim. The model needs message identity separate from message revision (rev + content hash).
6. **Usage granularity and basis differ by harness and must be declared, not assumed.**
   - per_response: claude-code, copilot, goose, agy, gemini, commandcode, devin.
   - per_turn: codex, vscode (local).
   - per_message per step: opencode.
   - per_session only: droid, zed cumulative.
   - none: cursor-agent.
   - A basis is two questions, whether input counts cached tokens and whether output counts reasoning (sessions-model §2.4). Vendor definitions settle claude-code, codex, gemini-cli and opencode v1. Everything else is null: token inequalities seen in fixtures (devin, zed, gemini, goose, commandcode) are compatible with both readings and establish nothing.
7. **Usage often has no message.** Examples: copilot `finishReason: length` with no `assistant.message`, codex `kind=usage` rows, goose ledger compaction rows, and session-level totals in droid and zed. Zero is often unknown: opencode aborted steps, cursor `{0,0}`, copilot BYOK cost 0. Usage should be a standalone record anchored to a `response_id` or session, with nullable fields.
8. **Compaction "replaces" comes in five shapes.**
   - first kept id: opencode `tail_start_id`, commandcode `firstKeptEntryId`.
   - last replaced id or index: droid `anchorMessage`, agy `included_step_index_end`.
   - a count only: copilot `messagesRemoved`, droid `removedCount`.
   - per-row flags flipped in place: goose `agentVisible`.
   - a blob archive: cursor-agent `summary_archives`.

   `summary.replaces` needs all of these forms (sessions-model §2.3 lists six, splitting `through_id` and `through_index`), and it is never a delete.
9. **Hidden and injected content is everywhere.** Examples: goose turn-context, droid `llm_only` context and `user_only` notices, copilot `system.message` and `model.*` snapshots, gemini session_context, cursor-agent `system_reminder`, commandcode `followup`/`steering`/`isAutomated`, devin keepalive, opencode synthetic text. Reasoning can be present but unreadable: empty with an opaque id (vscode), encrypted (copilot-cli (client vscode)), signature only (agy, droid). Visibility and source enums cover most of it; reasoning needs an `opaque` variant.
10. **Hook join is known for only four harnesses.**
    - copilot: the main session's sid, but sub-agent hooks carry `agentId` as `sessionId`.
    - copilot-cli (client vscode): sdk sid, not the VS Code id.
    - agy: `conversationId` + `stepIdx`.
    - commandcode: audit file per sid.
    - droid writes hook records into the transcript with forward references.

    The join target must be (session, agent_id, optional step), and sessions need alias ids.
11. **Sessions need alias ids and a native birth marker.** Alias cases: copilot-cli (client vscode) (`vsSid` vs `sdkSessionId`), commandcode (filename vs header id), copilot (`messageId` vs event id). Reuse cases: goose (`created_at`) and copilot (`session.start` id), and opencode import brings old ids back. A whole-file rewrite that keeps the session (droid line 1, commandcode migration, copilot rewind) must not mint an incarnation, even when, as in the commandcode migration, the message ids change.
12. **Requested and served model differ.** copilot `model` vs `modelDisplayName`, goose `requestedModel` vs ledger `model`, vscode `copilot/auto` vs resolved, agy enum vs `response_model`, cursor-agent Auto vs `modelName`. The model needs `requested_model` and `served_model`. Effort is a field only in some harnesses (copilot, commandcode, droid, opencode `variant`, cursor params). It is folded into the model id in agy and cursor-agent, and set per session in goose and zed.
13. **Sub-agents live in three places.** In the same session with an agent id (same file or tree, or the session's own agent files): copilot, vscode (local), devin, claude-code (agent files belong to the parent session). As a separate session with a parent link: cursor-agent, agy, opencode, goose, zed, droid (S), gemini (S). Not stored: commandcode. The model already has `agent_id` and a `subagent` link. It also needs a link whose target session may not exist.
14. **The source's own timestamp is not always the event time.**
    - Write or flush time: commandcode entry `timestamp`, droid writer clock.
    - Reset on save: devin rows.
    - Seconds only: goose.
    - None: zed.
    - Reset on fork: vscode (local).
    - Kept from the origin on fork: copilot, cursor, droid, goose, opencode.
    - Stored by a consumer before adapters (`ts_source: legacy`, v1.1): one such consumer kept each
      line's own `timestamp` for Claude Code, but had no per-message time for Codex, so it stored
      a time interpolated between the session's first and last times. Rows imported
      from such a store carry a time the source cannot give back, which none of `event`, `write`,
      `reset_on_save`, `seconds`, `none` or `first_seen` describes.

    Each harness must declare its `ts` source, with first-seen as the fallback, and order must not rely on ts alone.
15. **Fixture redaction was name-based and inconsistent** in the first captures (five different markers; usage counters, signatures and map keys hidden). **Resolved 2026-10-22:** the cursor, vscode, gemini-cli and agy captures were re-extracted under the normative field-path rule (one marker `<redacted len=N>`, lint exemptions kept verbatim, counters intact). Only re-extracted captures can be used for redaction and usage checks; the older captures remain evidence of shapes, record types and field names.

---

## 5. Fixed strings that mark a call cancelled or denied (v1.3)

sessions-model §2.3 lets a harness's own fixed string mark a `tool_result` `cancelled` or `denied`,
where the harness writes that string itself for the case (never tool or model output), matched
exactly. These are the strings. Each was read from the harness's source at the version its fixture
follows. A string not listed here never decides `cancelled` or `denied`, and the call reads as
`completed` with the harness store's own flag.

| Harness | Exact text | Marks | Source |
|---|---|---|---|
| zed | `Tool canceled by user` | `cancelled` | Zed v1.24.3, `crates/agent/src/thread.rs` (the constant, and where a cancelled call writes it) |
| zed | `Permission to run tool denied by user` | `denied` | Zed v1.24.3, `crates/agent/src/thread.rs` |
| zed | `Permission denied: user sent a follow-up message instead of approving the tool call.` | `denied` | Zed v1.24.3, `crates/agent/src/thread.rs` |
| goose | `The user has declined to run this tool. DO NOT attempt to call this tool again. If there are no alternative methods to proceed, clearly explain the situation and STOP.` | `denied` | Goose v1.55.0, `crates/goose/src/agents/tool_execution.rs` |
| goose | `Tool call was interrupted before completing` (no final period) | `cancelled` | Goose v1.55.0, `crates/goose-agent/src/machine.rs` |
| opencode | `The user rejected permission to use this specific tool call.` | `denied` | OpenCode v1.19.3, `packages/core/src/v1/permission.ts`, stored as the tool part's `state.error` |

How a string matches:
- **zed:** only in the shape Zed writes a canned result: `is_error` true and exactly one text item
  holding the string, as Zed's own check for a cancelled result reads it, or a single text value in
  place of the list, as builds before Zed's multi-part tool output stored it (v1.24.3 still reads
  that form).
- **goose:** the whole text of an MCP error result with one text block.
- **opencode:** equality with `state.error`. A tool that throws exactly that sentence would collide;
  none is observed.

Read as `completed` under the rule, with the harness store's flag:
- every agy denial: agy writes no fixed string or field for it that a public source shows, and its
  denial error embeds the command. agy's `CANCELED` and `INTERRUPTED` still come from its status;
- an OpenCode rejection with feedback, whose text embeds the user's words.

Strings found in source and not adopted yet: Zed's per-tool "… cancelled by user" errors and its
sandbox and policy denials (templates, not fixed strings), and the Goose CLI's own cancel message
(that call carries a stored denial already), and OpenCode v2's "Tool execution interrupted". OpenCode
v1's interrupted call needs no string: its error part's `metadata.interrupted` is a structured
marker, read as `cancelled`.

---

## Not established by a live run

The session-adapters package (1.0) proves every adapter against fixtures. Most fixtures follow a
lab capture. The shapes below do not: they come from the harness's source code, from earlier
readers, or from synthetic cases, and no live run has confirmed them. They are **not
established**. An implementation may rely on them only as far as the fixture does. A later live
run that confirms or corrects one updates this list and the package's `docs/live-check.md`.

### Every harness

- The join between a session's hook events and its records.
- What the usage numbers count (sessions-model §2.4). Where the flags are set (Claude Code, Codex, Gemini CLI,
  OpenCode v1), they rest on vendor definitions, not on a stored total. Where they are null,
  what `input` and `output` count is unknown.

### Claude Code and Codex

- The fixtures are synthetic, following long-running readers. A tool call, a compaction and a
  sub-agent are not confirmed against a live session.
- Whether Codex's `item_completed` CommandExecution event names a call id, so `exit_code` can
  be joined.

### Copilot CLI

- The wording a fork child writes about itself.
- That a `usage_record` comes before the message it bills.

### Gemini CLI

- The sub-agent file layout, compaction, and `orderIds`.

### VS Code

- `modelState` values other than 1, `kind 3` entries, and a `kind 0` in the middle of a file.

### Goose

- The usage ledger's time window, and the compaction anchor found by time.
- Four lab rows completed by hand.

### OpenCode

- The DDL, rebuilt from the spec and the captured columns.
- A v2 assistant row, rebuilt from its events.
- An interrupted tool call (an error part with `metadata.interrupted`), read from source only.

### Antigravity (agy)

- Whether a rewind deletes `gen_metadata` and `executor_metadata` rows.
- Whether a `response_id` is unique.

### Cursor IDE

- The lab case is thin: composerData and bubbles were captured at different moments, and two
  `params` cells were completed by hand.
- A rewind (expected implicit, truncated on the next send) and a delete.
- Where tokens are stored on a paid plan (the free plan stores `{0,0}`), and whether each child
  bubble carries its own call's counts.
- Whether an older Cursor without `composerHeaders` leaves bubbles behind on delete.
- How tool and text bubbles interleave; a sub-agent link (synthetic only); composerData as TEXT
  and bubbles as BLOB; whether `empty-state-draft` is reused.

### cursor-agent

- An ACP store (`acp-sessions/<id>/store.db`) holding a turn.
- An MCP call and the `google.protobuf.Value` shapes in its arguments.
- Step kind 34 (truncated in the source).
- Whether a step is written while it streams.

### Zed

- Resume, compaction, the parent-side `spawn_agent` link, a Mention and an Image (from source,
  synthetic fixtures).
- The `sidebar_threads` schema.
- After a checkpoint restore, whether a turn that survives the restore keeps its
  `request_token_usage` entry. (The restore and the regrow themselves are established by a lab
  capture, the package's `zed/restore-lab` fixture; it restored to the first message.)
- Editing and deleting a thread, and the rule that detects a legacy agent-1 thread.

### Devin Local

- No lab case: the samples are single rows, not whole trees.
- The `subagent_heads` row while a sub-agent runs (inferred).
- `/clear` (expected invisible), the hook join, `client: 'devin'`, and the hidden summary-agent
  session (`kind: 'hidden'`).
