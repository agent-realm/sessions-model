# Contract: sessions-model v1.1

**version:** v1.1
**between:** session adapters (providers) ↔ any consumer of what a harness keeps: memhouse's
capture engine, harness-skeleton's `sessions read`, a dashboard, an importer
**status:** the harness-neutral shape of a harness store's conversation data: one model, one adapter
per harness

One persistence model for every harness, and one adapter per harness that conforms to it. This contract is that model. It says:
- what a session, message, part, usage record, link and lifecycle record are;
- how each one is keyed;
- what a raw unit is;
- what an adapter must redact.

How an adapter reads, derives and hands records to a consumer is the seam,
[sessions](sessions.md). How a harness is configured is harness-skeleton's spec, which cites this
model by version.

**Evidence base.**
- Thirteen harness stores were observed with synthetic sessions on a lab VM (2026-10-19 to
  2026-10-22): Copilot CLI, VS Code (the Local and Copilot engines), Cursor IDE, cursor-agent,
  agy, OpenCode (the v1 and v2 engines), Goose, Gemini CLI, CommandCode, droid, Windsurf/Devin
  and Zed.
- Eight of them have a full adapter spec, which is not published.
- The fixtures this contract's conformance items cite are the session-adapters package's
  (harness-skeleton `packages/session-adapters/fixtures/<harness>/<case>/`), public and synthetic
  or scrubbed. A fixture path below is relative to that folder.
- Claude Code and Codex come from earlier source-identity work, not from the lab VM.
- A rule that cites a harness comes from those specs or fixtures. A point inferred only from
  fixture numbers says so. droid's records are non-normative: the harness is deferred, and its
  assistant records were written by its own serialiser from synthetic content.

## Scope

- **In:** sessions, messages, parts, usage, links between sessions, lifecycle records, identity,
  raw units, redaction.
- **Out:**
  - reading, deriving, cursors, continuity: the seam [sessions](sessions.md);
  - how a consumer stores or indexes rows;
  - harness configuration (harness-skeleton);
  - live event streams (ACP, hooks), except the hook join the seam grades.

## 1. Identity (the part that must not be wrong)

Every key starts with the folder the session lives in, on the host it lives on:

| Key | Made of |
|---|---|
| **session** | `(host, harness, harness_path, session_id, incarnation)` |
| **message** | session + `message_id` |
| **part** | message + `part_id` |
| **call** | session + `call_id`; links a tool call to its result |
| **usage** | session + `usage_id` (§2.4) |
| **link** | stating session + `(kind, other side's reference, at)` (§2.5) |
| **lifecycle** | session + `lifecycle_id` (§2.6) |

**`host`** names the machine. Every reader on one machine derives the same value, so two readers
(a consumer, a harness-skeleton driver, a sessions-sql loader) never key one session twice:
- `host` is the first 32 hex digits, lowercase, of sha256(`"sessions-model/host/v0:"` + the OS
  machine id), the whole input encoded as UTF-8. The machine id is the value's characters exactly
  as the OS stores them: only surrounding whitespace and newlines are stripped, with no case change,
  no dash or brace change and no re-formatting through a UUID or GUID library (two readers in
  different languages must hash the same bytes):
  - macOS: the `IOPlatformUUID` property of `IOPlatformExpertDevice`, uppercase with dashes. A reader
    parsing `ioreg -rd1 -c IOPlatformExpertDevice` takes the quoted value without its quotes;
  - Linux: `/etc/machine-id` only, 32 lowercase hex digits. `/var/lib/dbus/machine-id` is never
    read: on a systemd machine it is a link to `/etc/machine-id` or a copy of it, and a copy is
    exactly what a clone inherits after `/etc/machine-id` was emptied;
  - Windows: `MachineGuid` under `HKLM\SOFTWARE\Microsoft\Cryptography`, read from the 64-bit
    registry view (`KEY_WOW64_64KEY`, so a 32-bit reader is not redirected to `Wow6432Node`), as
    stored: lowercase with dashes, no braces. The registry stores it as UTF-16; it is hashed as
    UTF-8, like every other input.

  A machine id that does not have its OS's form (Linux: exactly 32 lowercase hex digits; macOS and
  Windows: a UUID) is unreadable. An empty file (what images ship so that first boot regenerates
  it) or systemd's first-boot placeholder `uninitialized` falls through to the `r-` value; it is
  never hashed.
- **Never the hostname.** `hostname` gives one Mac as `my-laptop`, `my-laptop.local` or a fully
  qualified name, and a rename changes it. A display label (`host_label`, e.g. `my-laptop`) may
  travel beside `host`; it is never part of a key.
- **No readable machine id** (some containers): `host` = `r-` + 32 lowercase hex digits of a
  random 128-bit id, persisted at one fixed path so that every reader on the machine reads the same
  one: `$XDG_STATE_HOME/sessions-model/host-id` (default `~/.local/state/sessions-model/host-id`;
  on Windows `%LOCALAPPDATA%\sessions-model\host-id`), mode 600. The file holds the 32 hex digits
  only, without the `r-` prefix; a reader strips surrounding whitespace and newlines and adds `r-`.
  The file belongs to one machine: it is never shared with or copied to another (a networked or
  roaming home, a copied home), and a cloner removes it like the machine id. The first reader creates it
  exclusively (if another reader wins the race, it reads that one); every other reader only reads
  it. The `r-` prefix marks the value as not derivable from the machine. The path belongs to one
  OS user, so readers on one machine must run as the same OS user to agree on an `r-` value.
- **Clones share a machine id.** A VM clone, a template or a disk image keeps its parent's
  `/etc/machine-id` (Windows keeps `MachineGuid` across imaging; a macOS VM can keep
  `IOPlatformUUID`) unless it is regenerated, and then two machines become one `host`. Where a
  clone also copies the home path, even `harness_path` matches: one key for two harness stores. A
  reader cannot detect a clone, so **whoever clones a machine image regenerates its machine id**,
  explicitly:
  - Linux: remove `/etc/machine-id`, `/var/lib/dbus/machine-id` and `/run/machine-id`, write a
    fresh id (`systemd-id128 new > /etc/machine-id`), and link `/var/lib/dbus/machine-id` to it.
    Emptying `/etc/machine-id` and running `systemd-machine-id-setup` is not enough: that command
    copies an inherited `/var/lib/dbus/machine-id` or `/run/machine-id` (or, in a VM, the
    hypervisor's UUID, which a clone may share) back in. Where there is no `systemd-id128`
    (Alpine and other musl images), write `dbus-uuidgen > /etc/machine-id`, or 32 lowercase hex
    digits from `/dev/urandom` (`od -An -N16 -tx1 /dev/urandom | tr -d ' \n' > /etc/machine-id`).
  - macOS: a VM cloned from one bundle (Virtualization.framework, tart, UTM) can share its parent's
    `IOPlatformUUID`, which comes from the VM's machine identifier: give the clone a new machine
    identifier.
  - Windows: a new `MachineGuid`.
  - The cloner's check: `cat /etc/machine-id` (or `IOPlatformUUID`, `MachineGuid`) on two machines
    cloned from one image gives two different ids.
- **Containers.** A container that bind-mounts its machine's id has that machine's `host`. Two such
  containers with the same paths inside (`/root/.claude`) would share one key for two harness
  stores, so a container does not borrow its machine's id: it has its own machine id, or no
  readable id and so the `r-` value.
- The salt is versioned. Changing it re-keys every session, so it changes only with a new version
  of this contract.

**`harness_path`** is the real path of the data folder the harness is bound to (harness-skeleton
binds a harness to it):
- **absolute**, with every symlink resolved, so one folder reached by two spellings gives one key;
- **in the case the filesystem stores.** On a case-insensitive volume (APFS and HFS+ by default on
  macOS), each component takes its on-disk case, as the native resolver reports it
  (`realpath(3)` / `F_GETPATH`; in Node, `fs.realpathSync.native`). An adapter never lowercases or
  otherwise normalises the path itself;
- **without** a trailing slash, compared as bytes;
- **never** a working directory.

**A harness bound to one database file** rather than a folder has that file's real path as
`harness_path`, under the same rules. A harness store is a **folder harness store** when its
`harness_path` is a data folder, and a **file harness store** when it is one database file.
**Every OpenCode harness store is a file harness store**, the default one included: the default `opencode.db`, each `opencode-<channel>.db`, and a database named by
`OPENCODE_DB`.
- Two such files can hold the same session id (an import into another channel), and only a
  per-file `harness_path` keeps them two sessions.
- One file reached two ways (the default `opencode.db`, and `OPENCODE_DB` set to that same file)
  resolves to one real path, so it has one key.
- OpenCode has no folder harness store, so no harness store's files lie inside another's.
- harness-skeleton's binding names the data folder. For OpenCode, the session key uses each
  harness store's file `harness_path`, never the folder.
- What a file harness store keeps in the shared data folder (OpenCode `tool-output/`) is a source outside
  its `harness_path`, with an absolute `source_key` ([sessions](sessions.md) §1).

Where these contracts need the three fields together, a JSON object `store` carries them:
`store = {host, harness, harness_path}`. That key is defined only by its fields. It never means a
consumer's database. It identifies exactly one **harness store**: the conversation data of the
harness bound to that `harness_path` on that host, including any it keeps elsewhere, by override
(pi `--session-dir`) or by design (Cursor IDE's `agent-transcripts` under `~/.cursor`, the VS Code
`agentSessionData` of a Copilot session). In prose these contracts say "harness store", never bare "store".

Rules:

1. **A session belongs to one folder on one host,** `(host, harness, harness_path)`. There is no
   "same session" across them: the same native id read on another host, or in another folder, is
   a **different session** (2026-10-22). A copied or synced home therefore yields one
   session per host. Positions, cursors and continuity are scoped the same way.
2. **Incarnation and reuse.** Every adapter declares `reuse` per harness:
   - `impossible`: ids are never reused (UUIDs, or ids carrying a random part). `incarnation = ''`.
   - `detected`: there is a **discriminating** birth marker, one that differs between any two lives
     of one id, including a delete and recreate in the same second. `incarnation` is that marker.
     The one observed case is Copilot CLI's `session.start` event `id` (a UUID); the
     `--session-id` reuse is shown in a fixture.
   - `undetectable`: ids can be reused within the harness store and no discriminating marker exists.
     `incarnation` is the best weak marker the harness store has, or `''` when it has none. Goose:
     `created_at`. Devin: `''`.
     - Goose's `YYYYMMDD_N` ids are a UTC date plus `MAX(N)+1`, reused after a delete. Its
       `created_at` has one-second resolution.
     - Inside one folder, a delete and recreate of the same id in the same second (Goose), or any
       reuse at all (Devin), cannot be told apart from one continuing session. That limitation
       is accepted and stated, never hidden. Across folders and hosts the question never arises, because
       both are part of the key.
   - A whole-file rewrite is not a new incarnation: a Copilot rewind, the CommandCode v1→v3
     migration, a Devin turn that re-inserts every node. The seam reports those as `reset` or
     `delta`, and the consumer revises.
   - An adapter never guesses `detected`. The annex states `reuse` and the exact marker field
     for every harness.
3. **One owner per harness store.** A harness store's writer format decides `harness`. The program that wrote a
   session is `client`. `harness` takes one value from this registry (§8): `claude-code`, `codex`,
   `copilot-cli`, `vscode`, `cursor`, `cursor-agent`, `agy`, `antigravity`, `opencode`, `goose`,
   `gemini-cli`, `commandcode`, `droid`, `devin`, `zed`, `kiro`, `jetbrains-copilot`, `pi`,
   `reference-harness`. `reference-harness` is the conformance reference harness that harness-skeleton plans: a program of its own whose native store is these records. A
   new harness adds its value in a v1.x. Two engines of one harness are told apart by `engine`.
   - **Copilot's `~/.copilot/session-state`** belongs to `copilot-cli`, including the sessions
     VS Code writes there (`client_name: vscode-agent-host` → `client: vscode`).
     - VS Code's `vsSid` is an alias of such a session.
     - Its `agentSessionData/<vsSid>/session.db` is a side source of the same session.
     - The `vscode` harness covers only VS Code's own `chatSessions` (`engine: local`).
   - **Cursor membership is authoritative, never inferred from a missing file.**
     - A `cursor-agent` session is a chat directory `chats/*/<id>/` with its `store.db`.
     - A `cursor` session is a composer in the IDE's `state.vscdb` (`composerHeaders` /
       `composerData`).
     - `agent-transcripts/<id>.jsonl` is a side source of whichever of the two holds the id.
     - A transcript whose id neither holds is an **orphan**: deleting a CLI chat removes its
       directory and leaves the transcript. A live `list` ignores orphans. A session the
       consumer already holds keeps its harness, and its deletion reaches the consumer as
       usual (fixture `cursor-agent/orphan/`).
   - **agy** (the Antigravity CLI) keys sessions from its conversation DB.
     `brain/<id>/…/transcript_full.jsonl` is a side source; after a rewind its step positions
     differ from the DB's, and the DB wins. `antigravity` names the desktop hub and IDE, whose
     data dirs are separate from agy's.
4. **`message_id` is the native id.** Fallbacks, in order of preference:
   - **Anchored:** `<anchor_id> + '+' + n`, where the anchor is the nearest preceding native
     message id in the same session and `n` counts from 1. Zed's assistant messages hang off the
     user message's `id`. In Zed, a checkpoint restore removes the user message too, so the
     regrown turn hangs off a new anchor and gets new keys.

     An anchored key names a position after its anchor, not the content there. When a
     truncate-and-regrow keeps the anchor, the regrown message takes the same key and is a
     revision of it: its `content_sha` and `cmp_sha` change, and a consumer sees one message
     revised, not two. When the anchor itself is gone (Zed's restore removes the user message),
     the regrown messages hang off a new anchor and so get new keys. A lifecycle record shows the
     truncation only where the harness store records one.
   - **Offset:** `'@' + <the byte offset or the ordinal>`, never the inode. Allowed only for
     append-only streams: Codex rollouts, CommandCode v1 files, the agy jsonl when the DB is
     absent.
   - Never an index of emitted rows.
   - A harness store that rewrites and has no native ids at all is **lossy** for identity. The adapter
     declares it, and the annex names it.
5. **Identity is not revision.** A native id can repeat within a session:
   - Gemini CLI rewrites a record id with last-wins;
   - Devin writes streaming twins and prefix copies;
   - Cursor IDE keeps a `bubbleId` while its text is edited;
   - cursor-agent re-mints turn blobs;
   - Claude Code re-appends records verbatim.

   A derive emits one record per key, in its final state, with a `content_sha`.

   **Migration copies are folded only on evidence.** The CommandCode v1→v3 migration re-appends a
   run of earlier messages under fresh entry ids. In one migrated session, entries 5–7
   copy entries 2–4, and their parents differ because the copies chain onto entry 4. The fold:
   - **Evidence:** the session has a migration backup side source (CommandCode's
     `<uuid>.v2.bak`). No backup, no fold.
   - **Match:** a contiguous run of messages `C = c1…ck` whose `cmp_sha` sequence equals an
     earlier contiguous run `O = o1…ok` (the same k, the same order), where `C` starts right
     after the original records the backup holds. Matching is by sequence, never message by
     message.
   - **Fold:** each `ci` becomes an alias of `oi`. Every record whose parent is some `ci` is
     re-parented to `oi`, so in that session, entry 8's parent, one of the copies, becomes the original it copies.
   - **Never:** independent repeats with equal content stay separate messages, such as Gemini CLI's
     two identical errors in `gemini-cli/rewind/` (a negative conformance case), and
     any repeat in a session without migration evidence. A fold never crosses a session.
6. **Calls.** `call_id` is native. Where it is absent, it is `'@' + <the tool_call's message_id> +
   ':' + index`: always the call's message, never the result's.
7. **`ts` is the source's own** and never changes for a key. `ts_source` (§2.1) states what it
   means; `legacy` is the one case where it is not the harness store's own. A missing `ts` is
   null, and the consumer applies its first-seen rule.
8. **Determinism.** The same raw units in the same harness store give the same keys after a lost cache
   and after a re-derive. An `adapter_ver` bump may change keys only with a migration note.
9. **Aliases.** A session or message may have more than one native id: VS Code `vsSid` vs the
    Copilot `sdkSessionId`; CommandCode filename vs header `id`; Copilot event `id` vs
    `data.messageId`. `aliases: [{id, kind}]` lists them. The key uses the id the harness
    store addresses the record by.
10. **Positions are not identities.** agy reuses `idx` after a rewind; Goose re-mints `messages.id`
    on `--edit`; Devin re-inserts every row per turn. Each of them has a stable native id, and
    keys use it.
    - **A positional id is the last resort.** It applies only to a record with no native id, in an
      append-only source: `@<byte offset>` (the annex's Codex items without `payload.id`, agy's
      transcript fallback). Every id derived from it (a lifecycle record's, a call's
      `@<message_id>:<n>`) inherits it.
    - **Where a session can have several `main` sources** (Codex rollouts that share an id), a
      positional id is qualified by its source from the first read: `<source name>@<byte offset>`.
      The source name is the part of the `source_key` that survives the harness moving the file
      and that is unique among the session's main sources (Codex: the rollout file name, which
      carries the session's uuid). Where no such part is unique, the qualifier is the whole
      `source_key`, and a move then re-keys that source's positional ids. For a harness that never
      moves its files, the source name is the whole `source_key`. A second source appearing later
      never changes the first source's ids. A harness whose session has one main source keeps the
      bare `@<byte offset>`. The annex says which form each harness uses.

## 2. Normalised records

Five record types: `session`, `message` (with nested parts), `usage`, `link` and `lifecycle`. Every
record names its type in `type`, which takes exactly one of those five values, and carries its session key (`host`, `harness`, `harness_path`, `session_id`, `incarnation`),
plus its own key fields (§1), and two hashes:
- `content_sha` is the sha256 of the record's JCS canonical JSON, excluding `content_sha` and
  `cmp_sha` themselves. It detects a revision.
- `cmp_sha` exists on messages only. It is a **semantic comparison hash**: two copies of one
  message in two sessions share it even when a fork re-minted their ids. It is the sha256 of the
  RFC 8785 (JCS) canonical JSON of this projection:
  - `role`;
  - `parts`, in order, as `{kind, …}`, with:
    - `text` for text, reasoning, summary and notice (reasoning that is `opaque` contributes
      only `opaque: true`);
    - `name` and `args` for tool_call;
    - `output` (as stored) and `is_error` for tool_result;
    - `media_type` and the sha256 of the decoded bytes for attachments (null when a `ref` cannot
      be read);
    - `error_kind` and `message` for error.

  Excluded, because they are structural identity or fork-reset fields:
  - `message_id`, `part_id`, `call_id`, `parent_id`, `response_id`, `aliases`, `ts`, `order`;
  - the model fields, `status`, `state` and visibility;
  - session titles and both hashes themselves.

  Ids inside content are content and stay in: a path in tool args, an id quoted in a reply.

### 2.1 Session

| Field | Type | Meaning |
|---|---|---|
| `harness`, `engine`, `client` | string | §1 rule 3 |
| `harness_version` | string | version that last wrote the session, when the harness store says so |
| `title`, `title_set_by` | string, enum | `user` \| `auto` \| `unknown` |
| `cwd`, `last_cwd` | string | at creation; latest, where the harness store tracks moves (droid, cursor-agent `meta.json`) |
| `created_at`, `updated_at` | ts | native; null when absent |
| `state` | enum | `active` \| `archived` \| `deleted` |
| `pinned` | bool \| null | droid `.favorites`, agy annotations |
| `mode` | string | native mode (plan, agent, ask, autopilot …) |
| `kind` | string | native session type: Goose `user`, `sub_agent`, `hidden`, `terminal`, `scheduled`, `acp`; Devin hidden summary-agent sessions |
| `reuse` | enum | §1 rule 2 |
| `ts_source` | enum | what the harness store's `ts` means: `event`, `write` (CommandCode entries, droid), `reset_on_save` (Devin rows: the message's own `metadata.created_at` is used instead), `seconds` (Goose), `none` (Zed), `legacy` (v1.1: the time a pre-adapter consumer stored, not recoverable from the source; only a consumer importing rows it stored before it read through an adapter writes it, and an adapter never emits it). `first_seen` is the fallback |
| `aliases` | list | §1 rule 9 |
| `fingerprint` | object | `cmp_shas`: the ordered `cmp_sha` of **every** message on the session's current line. The consumer uses it to nominate fork candidates (§2.5) |
| `setup` | object \| null | the harness setup the session was created under, where the harness store records it (in practice a harness that is its own launcher, such as the planned `reference-harness`); otherwise null. Hashes and names only, never rendered text or environment values: `launch_digest` (hs's launch digest, or null), `surface` (component name → sha256), `system_prompt_sha256`, `tools` (names), and `digest` (the sha256 of the canonical JSON of the other four). It is the setup at creation: a resume under another setup writes its new `digest` in its resume `notice`. An adapter reads it and never computes it from outside the harness store |

### 2.2 Message

| Field | Type | Meaning |
|---|---|---|
| `message_id` | key | §1 rules 4–5 |
| `parent_id` | string | native parent pointer, if any. **Order is never derived from it.** Copilot's `parentId` dangles after rewinds and side calls; droid's tree branches under concurrent writers |
| `order` | string | the native ordering key: line position, `seq`, rowid, `idx`, tree walk. Order is by `order`, then `ts` |
| `agent_id` | string | `''` = main conversation; otherwise a sub-agent that lives **in this session's sources**. Claude Code's sub-agent files belong to the parent session with `agent_id`; so do Copilot's and Devin's in-file sub-agents |
| `role` | enum | `user` \| `assistant` \| `system` \| `tool`. A tool result that the harness store writes with role `user` (droid, Gemini CLI, Goose) is `tool` |
| `source` | enum \| null | `user` \| `model` \| `injected` (rules, context, reminders) \| `hook` \| `system_notice` \| `steering` \| `automated` (loops, schedules, goals). Null where nobody in that list sent it, or the harness store does not say who did: a tool result (`role: tool`), a VS Code `hiddenFromTranscript` request |
| `to_user`, `to_model` | bool \| null | visibility as two flags. Goose compaction sets `agentVisible=false`: `to_user: true, to_model: false`. droid `llm_only` and Gemini's injected `<session_context>`: `to_user: false, to_model: true`. droid `user_only` notices: `to_user: true, to_model: false` |
| `status` | enum | `complete` \| `streaming` \| `interrupted` \| `error` \| `cancelled` |
| `state` | enum | `current` \| `reverted` (hidden by a revert the harness store can undo: OpenCode `session.revert`) \| `retracted` (an append-only retraction removed it while the record stays in the source: Gemini `$rewindTo`, `$patch.removeIds`, VS Code `kind 2`; §2.6 (a)). A destructive delete is not a state: the key is tombstoned (§2.6 (b)) |
| `on_active_branch` | bool \| null | tree-shaped harness stores that keep abandoned branches: CommandCode, Devin, droid under concurrent writers |
| `ts` | ts | §1 rule 7 |
| `requested_model`, `served_model` | string | as stored; they differ in Copilot, Goose, VS Code, agy and cursor-agent. Placeholders (agy `MODEL_PLACEHOLDER_M418`) are kept verbatim |
| `effort` | string | a field in Copilot, CommandCode, droid, OpenCode (`variant`) and Cursor IDE. Folded into the model id in agy and cursor-agent (left unparsed). A session field in Goose and Zed |
| `response_id` | string | the billing unit: Claude `message.id`, Codex turn id, OpenCode assistant message |
| `aliases` | list | §1 rule 9 |
| `parts` | list | §2.3, in native order |

**One speaker per message.** Where a native record holds both sides of a turn, the adapter splits
it into a user message and an assistant message:
- **VS Code** `requests[]`: the user message is `requestId`, and the assistant message is the
  request's `responseId`. Where that is absent, it is `<requestId> + ':response'`.
- **Cursor IDE**: the user bubble keeps its `bubbleId`. The assistant children (`<bubbleId>/s:n`,
  `<bubbleId>/t:<call>`) form one assistant message, `<bubbleId> + ':assistant'`. Each child is a
  part, with `part_id` = the child suffix (`s:0`, `t:<call>`).

### 2.3 Parts

Each part has a `part_id`: a string that is unique and stable within its message.
- The native part id where the harness store has one (OpenCode `prt_…`, Cursor `/s:n` and `/t:<id>`, the
  OpenCode v2 content `id`);
- otherwise the block index as a decimal string.

A native part that holds both a tool call and its result (OpenCode `tool`, VS Code
`toolInvocationSerialized`, a Cursor `/t:` bubble) becomes two parts, `<native>:call` and
`<native>:result`, sharing the `call_id`.

A part may carry its own `source` and `state`, taking the values of the message fields of those
names, where they differ from its message's:
- `source: 'injected'` for content the harness added to a user's message: an OpenCode synthetic
  part, a Zed mention's expanded file;
- `state: 'reverted'` for a part that a revert hides inside a message that stays (OpenCode).

Neither enters `cmp_sha`, as the message's own do not.

| `kind` | Fields | Notes |
|---|---|---|
| `text` | `text` | |
| `reasoning` | `text` \| `opaque: true`, `signature_len` | `opaque` covers an empty value with an id (VS Code), encrypted content (VS Code Copilot engine) and signature-only records (agy, droid) |
| `tool_call` | `call_id`, `name`, `args` (JSON), `server` (MCP) | |
| `tool_result` | `call_id`, `is_error` (true \| false \| null), `status` (`completed` \| `cancelled` \| `denied`), `output` \| `output_ref`, `output_len`, `truncated`, `exit_code` (integer \| null) | `output_ref` is `{ref, sha256, bytes}` for output kept elsewhere: `ref` names it (a spilled side file of OpenCode `tool-output/`, Gemini `tool-outputs/` or agy `steps/<n>/output.txt`; a cursor-agent `blob:<id>`), and `sha256` and `bytes` describe its content, so a consumer can check a copy without reading the harness store. Both are null when the content is no longer stored (OpenCode cleans its spills up). `exit_code` is a shell tool's, where the harness store keeps it apart from the output (Zed keeps it only inside the text). `is_error` is null where the harness store has no flag (CommandCode), and where its flag is unreliable (Zed stores `false` for a failing command) |
| `attachment` | `media_type`, `inline` (base64), `ref` (path), `bytes_len` | one of `inline` and `ref` is null. Images inline (Copilot, CommandCode, droid); PDFs by path (droid) |
| `summary` | `text`, `replaces` | a compaction summary. **Never a delete**: the replaced messages stay current |
| `error` | `error_kind`, `message`, `http_status` | provider and harness errors stored in the transcript. The field is `error_kind`, because `kind` is the part's own |
| `notice` | `text`, `level`, `native_type` | info lines, restart notices, hook output; also any native kind the model lacks (OpenCode `step-start`, `step-finish`, `patch`, `snapshot`). Never dropped |

`summary.replaces` takes one of six forms:
- `{first_kept_id}`: OpenCode `tail_start_id`, CommandCode `firstKeptEntryId`;
- `{through_id}`: droid `anchorMessage`;
- `{through_index}`: agy `included_step_index_end`;
- `{count}`: Copilot `messagesRemoved`, droid `removedCount`;
- `{flags}`: model visibility flipped in place on the replaced rows (Goose). Those messages are
  derived again with `to_model: false`;
- `{archive_ref}`: cursor-agent `summary_archives`;
- `unknown`.

### 2.4 Usage

Usage is its own record type, never a part. Many harness stores keep usage with no message:
- Copilot leaves a `usage_record` when a reply is capped and no `assistant.message` follows;
- Codex has `kind = usage` rows;
- the Goose ledger has compaction rows;
- droid and Zed keep session totals.

| Field | Meaning |
|---|---|
| `usage_id` | the native id (Copilot `apiCallId`, a Goose ledger row id, a Gemini record id), else `<anchor> + '#' + n`. The anchor serialises as `response:<id>`, `message:<id>`, `session` or `compaction:<id>`. `n` counts from 1, over the usage records with that anchor in derive order: sources in `list` order (main, then agent, then side, each by `source_key`), units in source order |
| `anchor` | `{response_id}` \| `{message_id}` \| `{session}` \| `{compaction}`, so a consumer counts each usage once (`per_record` usage, below, is the one exception: its records share a `response_id` and are counted once together) |
| `input`, `output`, `cache_read`, `cache_write`, `reasoning`, `tool_prompt`, `cost` | each nullable. `tool_prompt` is input the vendor counts apart from both `input` and `output` (Gemini's `toolUsePromptTokenCount`, a gemini-cli record's `tokens.tool`); null where the harness store reports none. **A stored zero is null** where the harness store uses zero for unknown: an aborted OpenCode step, Cursor IDE `{0,0}`, Copilot's BYOK `cost` 0. An adapter keeps a zero only when it knows the zero is real |
| `input_includes_cache` | `true` \| `false` \| null: whether `input` already counts the cached input that `cache_read` and `cache_write` report |
| `output_includes_reasoning` | `true` \| `false` \| null: whether `output` already counts the reasoning tokens, whether or not `reasoning` reports them apart |
| `granularity` | `per_response` \| `per_message` \| `per_turn` \| `per_session` \| `per_record`. A per-session total is never spread over messages. `per_record` is not a scope: its values are one response's usage, stored repeated on every record of that response. It exists only for rows kept as given, and an adapter never emits it (see *No overlap*) |
| `model` | the served model the usage was billed against, where the harness store says |

**What `input` and `output` count.** Vendors split tokens two different ways, and the harness store
keeps what its vendor reported:
- Cached input is either inside `input` (OpenAI, Gemini) or beside it (Anthropic).
- Reasoning tokens are either inside `output` (OpenAI, Anthropic) or beside it (Gemini).

The two flags say which, per record:
- the total input is `input` when `input_includes_cache` is true, and
  `input + cache_read + cache_write` when it is false. In both cases it adds `tool_prompt` where
  that is not null (Gemini, whose `input_includes_cache` is true);
- the total output is `output` when `output_includes_reasoning` is true, and `output + reasoning`
  when it is false.

The adapter copies the stored numbers as they are and never converts them. A flag is null until a
vendor definition of the usage the harness stores, or a discriminating observation (a stored total
that equals one sum and not the other), establishes it. Token inequalities alone never do.
Per harness:

| Harness | `input_includes_cache` | `output_includes_reasoning` | `reasoning` from | Established by |
|---|---|---|---|---|
| claude-code | false | true | not reported apart (null) | the Anthropic Messages usage, stored as is: `input_tokens` leaves out `cache_creation_input_tokens` and `cache_read_input_tokens`; thinking is billed in `output_tokens` |
| codex | true | true | `reasoning_output_tokens` | the OpenAI usage behind Codex's `token_count`: cached input and reasoning output are subsets of `input_tokens` and `output_tokens`, and `total_tokens = input_tokens + output_tokens` |
| gemini-cli | true | false | `tokens.thoughts` | the Gemini `usageMetadata` behind the record's `tokens`: `cachedContentTokenCount` is part of `promptTokenCount`, and `thoughtsTokenCount` is apart from `candidatesTokenCount` |
| opencode (v1) | false | false | `tokens.reasoning` | OpenCode's own definition: `input = prompt − cache.read`, `output = completion − reasoning` |
| opencode (v2), copilot-cli, vscode, goose, agy, cursor, zed, devin | null | null | Copilot `reasoningTokens`, agy `thinking_output_tokens`; otherwise null | nothing yet: these harness stores pass several providers' numbers through, or keep fields no definition covers |
| cursor-agent | — | — | — | no usage stored |

**No overlap.** A session's usage records never count the same tokens twice, so a consumer can sum
them, apart from `per_record` usage, which a reader collapses first (below). Where a harness store keeps a total beside values that are not its parts, the adapter emits
the total only, and the other values stay in raw units: Zed's `request_token_usage` values do not
sum to its `cumulative_token_usage` (annex), so Zed has one `per_session` record.

**The one exception: `per_record`.** Usage stored as given, where a harness repeated one response's
usage on every record of that response (Claude Code's records, one per content block, as an earlier consumer stored them),
has the granularity `per_record`. Such records overlap, and a reader collapses them before
summing. Decided 2026-10-23.
- **It always has a `response_id`, anchored as `{response_id}` (`response:<id>` in its
  `usage_id`),** never `{message_id}`, `{session}` or `{compaction}`. There is no fallback for a
  usage record without one.
- **A converter that lacks the native id mints one** from a run: consecutive repeated rows of one
  session, with one parse and one agent and an identical `(input, cache_read, cache_write, model)`.
  A minted id is marked as inferred, not native, by the reserved prefix `legacy-run:`, for example
  `legacy-run:<origin>:<epoch>:<first seq>`. No native id starts with it.
  - **`output` is not in the run's tuple.** The blocks of one streamed response carry a growing
    `output`: a partial count on the early blocks, the response's total on the last. With `output`
    in the tuple, one response would split into several runs. Within a run `output` never
    decreases.
  - **The one case a run cannot detect:** two different responses in a row with an identical
    `(input, cache_read, cache_write, model)` merge into one run, and one of them goes uncounted.
    The context usually grows between responses, so `cache_read` usually differs.
- **A reader counts one `per_record` usage per `response_id`: the last of its records in order**
  (the greatest `n` in `response:<id>#n`), not the first and not a sum. It holds the response's
  total `output`, the greatest of its records, and the same input and cache counts as the rest.
  The rule is the same for a native `response_id` and a minted one.
- **Where a `per_response` usage and `per_record` usages share a `response_id`,** the reader
  counts the `per_response` one and ignores the `per_record` ones.
- **An adapter never emits `per_record`.** It collapses a repeated usage at derive time into one
  `per_response` record. `per_record` exists only for rows kept as given.

### 2.5 Link

A link is a directed edge from a **child** session to its **origin**.

| `kind` | Meaning | Explicit in |
|---|---|---|
| `fork` | a user-made copy that continues separately | agy `parent_references`; droid `parent` + `forkedAtMessageId`; CommandCode `parentSessionId`; Copilot `session.info{fork}` (text); VS Code `agent-host.db` `origin` |
| `subagent` | a child conversation in **separate** sources, started by a tool call | cursor-agent `subagentInfo`; agy `parent_conversation_id` and the parent's `invoke_subagent`; OpenCode `session.parent_id` and the parent's `task` part; Zed `subagent_context`; Goose `parent_session_id` |
| `rewind_copy` | a rewind that writes a new session | droid `rewind.rewoundFromSessionId` |
| `clear` | `/clear` ends one session and starts another | none observed. Copilot and agy start a new session with no record naming the old one (Copilot's `context_cleared` is SDK-only). Gemini CLI's `/clear` appends context in the same session, so it is not a link |
| `continuation` | compaction or overflow moves the conversation into a new session. It carries a summary, not messages (unlike `fork`), and it carries something (unlike `clear`) | the planned `reference-harness` only: no other harness store is known to record one |

Fields:
- `child` and `origin` are each a **reference**: `{harness, session_id}`, plus the `incarnation`
  only when the stating session knows it. A reference names the other session's `host` and
  `harness_path` only when the harness records them. Otherwise it means **the stating session's
  own folder on its own host**, which is where every observed harness keeps its forks,
  sub-agents and cleared sessions.
  - A derive sees one session, so it often cannot build the other side's full key. Goose's
    `parent_session_id` lacks the parent's `created_at`; Copilot's fork text lacks the birth
    event.
  - The adapter emits the reference unresolved, and the consumer resolves it against the
    sessions it holds. The link keeps `evidence: explicit`.
- `stated_on`: `child` or `origin`, meaning which session's records carry the statement. The
  OpenCode `task` part, the agy `invoke_subagent` result and Copilot's parent-side
  `session.info{fork}` are stated on the origin.
- `at`: the `call_id` for `subagent`, and the `at_message_id` for `fork`, `rewind_copy` and
  `clear`. For `continuation`, it is the `at_message_id` of the origin's compaction point; the
  compaction's lifecycle record is reachable from that message. It is `''` only when the harness
  store gives no point.
- `inherits`:
  - `through_message_id`;
  - `ids_preserved`: true in 9 of the 11 forking harness stores observed; OpenCode and VS Code Local mint
    new ids;
  - `marked`: copied records point back (agy `source_trajectory_step_info`, CommandCode
    `meta.messageId`);
  - `usage_copied`: Copilot `usage_record`s, Goose accumulated counters;
- `child_stored`: false when the harness store never saved the child (CommandCode keeps no sub-agent
  transcript);
- `evidence`: `explicit` from an adapter; `inferred` only from the consumer.

**Keys and the two sides of one edge.**
- A **statement** is keyed on the session whose derive states it: `(stating session, kind,
  other side's reference, at)`. Statements are adapter-owned records, reconciled against `live`
  like any other.
- **Resolution.** The consumer resolves a reference within the harness store its `store` names (by default the
  stating session's own), and only when exactly one held session there matches.
  - It narrows candidates by the incarnation the reference names, then by a birth marker
    consistent with the stating session's own creation.
  - Several candidates (a Copilot id reused under `--session-id`; a Goose id reused within the
    harness store) leave the reference **unresolved**.
- **Merge.** After both endpoints resolve, the consumer merges statements of one edge into one
  **edge** when kind and both endpoints agree, and `at` is equal or empty on one side. The
  merged edge keeps the non-empty `at`, and is `stated_on: both`.
  - OpenCode: the child's `parent_id` gives `at: ''`, and the parent's `task` part gives the
    call; the pair is cited in the annex.
  - Statements whose `at` values conflict, or that could pair with more than one statement on
    the other side, stay separate edges.
- **Edges are the consumer's projection.** Merged and inferred edges have their own lifetime: an
  edge disappears when its last supporting statement is tombstoned or removed, or (when inferred) when
  verification no longer holds.
- When the child is not stored, only the origin's statement exists.

**Inferred links belong to the consumer.** A derive emits explicit links only. The consumer
uses session `fingerprint`s (§2.1) to **nominate** candidates, such as a session whose leading
`cmp_shas` match a prefix of another's.

It then **verifies on full content**, not on the fingerprint again, before it assigns
`inherits` or bills anything:
- The candidate child's first k messages and the origin's messages up to the fork point are
  compared pairwise. The comparison is on the **full normalised content**, with only the
  structural identity fields excluded (the same list as `cmp_sha`):
  - every part's full text;
  - tool args and full tool outputs, reading an `output_ref` side file's content where the
    output was spilled;
  - attachments by their decoded bytes.
- Where `ids_preserved` holds, the pairs also match on `message_id`.
- The matched range is contiguous from the child's first message.

A candidate that cannot be verified in full stays **unresolved**: an unreadable attachment `ref`,
a missing side file, or a truncated output on one side are all enough. It gets no `inherits` and
no billing suppression. A fingerprint match alone never creates a link.
That covers OpenCode forks (`parent_id` stays NULL; only the `(fork #N)` title and the copied
content remain), cursor-agent, Cursor IDE, Goose and VS Code Local.

### 2.6 Lifecycle

| Field | Meaning |
|---|---|
| `lifecycle_id` | the native record id, else `<source_key> + '@' + <unit_key> + '#' + n`, where `n` counts from 1 over the lifecycle records derived from that unit |
| `op` | `rewind` \| `edit` \| `compaction` \| `delete` \| `archive` \| `unarchive` \| `rename` \| `pin` \| `unpin` \| `fork` \| `clear` |
| `target` | `{message_id}` \| `{range: {from_id, through_id}}` \| `{session}` |
| `at` | the message the op applies at, when distinct from the target |
| `ts` | when the harness store says |
| `evidence` | `explicit`: lifecycle records exist only for operations the harness store records |

How a harness store shows each operation, recorded in the adapter's `lifecycle.<op>` facet:
- **explicit**, as a record. There are two different shapes:
  - **(a) Retraction, append-only.** The target stays in the source, and a later unit retracts
    it: Gemini `$rewindTo` and `$patch.removeIds`, VS Code `kind 2` with `i`. The unit arrives
    `appended`. The derive marks the targets `state: retracted` and emits a lifecycle record.
    **Nothing is tombstoned.**
  - **(b) Destructive, with an event.** The harness store deletes or rewrites the target and also logs
    the act: Copilot rewrites `events.jsonl` and appends `session.info{rewind}`; OpenCode
    deletes rows and writes `message.removed`. The derive emits the lifecycle record. The
    targets disappear through `reset` or `delta`, and the consumer tombstones them.
  - Also explicit: OpenCode `time_archived`, Goose `archived_at`, droid `archivedAt`, the
    summary records of compaction.
- **implicit**: rows vanish, a file is rewritten, or a pointer moves. Copilot rewrites
  `events.jsonl` shorter; cursor-agent moves `latestRootBlobId` back; OpenCode deletes on
  prompt-while-reverted; agy deletes DB rows; Cursor IDE overwrites bubbles; Goose `--edit`
  re-inserts the session.
  - These reach the consumer as `reset` or `delta` (see [sessions](sessions.md)). Keys absent
    after the derive are tombstoned by the consumer.
- **invisible**: the harness store keeps no trace.

## 3. Raw units

A **raw unit** is the smallest native piece an adapter reads (for `rows-json`, the smallest set of
rows that one transaction must read together), and every normalised record derives
from raw units. Every unit carries:
- `source_key`: which source of the session;
- `unit_key`: its identity within the source (defined per position kind in
  [sessions](sessions.md));
- `enc`, one of:
  - `utf8`: a text line or document;
  - `b64`: opaque bytes;
  - `row-json`: a SQLite row as a canonical JSON object of columns, with blobs in base64;
  - `rows-json`: several rows read in one transaction as one unit, as the canonical JSON object
    `{<table>: [<row-json>, …]}` with each table's rows in primary-key order (a Devin session's
    node tree, tool states and sub-agent heads). Where the harness mints the primary key again on
    every save (Devin's `row_id`, and the row `created_at` beside it), the unit leaves those
    columns out and orders the rows by a stable natural key (`node_id`), so an unchanged session
    reads as unchanged;
  - `pb-json`: a protobuf blob decoded to a JSON field tree, with `orig_sha256` of the original
    bytes kept so content-addressed links still resolve. It is
    `{orig_sha256, fields: [<entry>, …]}`, the entries in wire order, each `{n, w}` (field number,
    wire type) plus one of: `v` (a varint, a number, or a decimal string beyond 2^53), `b64` (the
    stored bytes of a field), `fields` (a length-delimited field decoded) and `redacted` (the
    marker). A blob is decoded only along the paths it must redact, and a blob with nothing to
    redact stays `b64`;
- `bytes`;
- `sha256`: of the bytes as emitted, after redaction;
- `orig_sha256`, in a `row-json` unit whose compressed column `read` decoded (Zed's zstd `data`):
  the sha256 of the stored bytes, as a `pb-json` unit keeps it;
- `redacted`: bool.

Sidecars are sources too, and their contents are raw units: droid `settings.json` and
`.favorites`, CommandCode `meta.json`, Copilot `workspace.yaml`, Zed `sidebar_threads`, VS Code
`agentSessionData` `session.db`.

**Reproducibility.** A session's normalised records are a pure function of:
- the ordered raw units of all its sources, since each source's current generation began;
- the adapter's declared state (`derive` in [sessions](sessions.md)).

A full replay from empty state equals every incremental path. Conformance compares the
**folded final state** of the records, never the stream of updates.

## 4. Redaction

1. **Field paths are normative.** An adapter's `describe` publishes the secret-bearing field
   paths for its harness, and the adapter replaces every value on them, in raw units and in
   records. Known paths:
   - Goose `extension_data` stdio `envs` values;
   - Zed `initial_project_snapshot.git_state.remote_url` (it can embed credentials), its `diff`,
     and `draft_prompt`;
   - Cursor IDE `composerData.blobEncryptionKey`, `speculativeSummarizationEncryptionKey`, and
     `encrypted_model` inside its `agentKv:blob` rows (those are cursor-agent turn blobs);
   - cursor-agent meta `blobEncryptionKey`, turn `encrypted_model`, and the arguments and result
     of a credential tool (`mcp_login`, `replace_env`, `connect_scm`, an MCP call to such a tool,
     and any step kind the adapter does not know), keeping only the fields that name the call.
     The step blob alone decides, never a later blob that names the call;
   - droid `promptCacheKey.key`;
   - Gemini CLI checkpoint `authType`;
   - VS Code selected-model metadata `auth`.
2. **One marker:** the string `"<redacted len=N>"`. A cut value may keep a prefix that carries no
   secret before the marker: a URL keeps `scheme://host` (OpenCode attachment and provider-error
   URLs, Goose MCP resource URIs in tool results), since its user info, path and query are what can hold a token.
   - For a string value, N is the byte length of its UTF-8 encoding, without quotes.
   - For bytes, N is the byte count.
   - For a protobuf field, N is its wire bytes.
   - For any other value, N is the length of its compact canonical JSON.
3. **A name lint is a check, not the rule.** String values under a key matching
   `key|token|secret|auth|password|credential|cookie|csrf` (case-insensitive) that no declared
   path covers fail the lint. The adapter either adds the path or lists the field as an explicit
   exemption.
   - Exempt by definition:
     - numeric values (`maxTokens`, `inputTokens`, `tokenCount` …);
     - key **names** (KV row keys, protobuf map-entry keys, JSON object keys): the lint looks at
       values under them;
     - `signature`, which is reduced to `signature_len` under §2.3, not redacted.
   - Exemptions found in the lab, none of them secrets: Cursor `originalFileStates.*.contentKey`;
     VS Code `cacheKey`, `tokenizer`, `tokenType` and URI `authority` (where its object has a
     `scheme`); agy `aggregation_key`, `accumulated_sections.key` and `time_to_first_token`.
   - Vendor-encrypted reasoning (VS Code `encryptedContent`, `reasoningOpaque`) is not a secret of
     the user's. Its normalised part is `opaque: true` with a length, and its raw value may be
     kept.
4. **Protobuf.** Redaction applies to the decoded tree (`pb-json`). Bytes are never re-encoded, so
   framing and content addresses (`orig_sha256`) survive.
5. **A redacted unit sets `redacted: true`.** For those fields the consumer's archive is no longer
   a verbatim copy of the harness store. That is an accepted cost: nothing can re-derive the removed
   values later, which is the point.
6. **Free text is out of reach.** A secret the agent printed sits in free text that no path covers:
   a tool result of `env`, a `cat` of a token file, a key pasted into a prompt. Resolved secret
   references reach the agent's shell tool (harness-skeleton's v0.2 design note, §5.3 "Secrets"). Consumers treat transcripts
   as sensitive data, whatever the adapter redacted.
7. **Credential files are never read:** `auth.json`, `oauth_creds.json`, keyrings, `cli-config.json`
   auth fields, Cursor `cursorAuth/*`. An adapter names them by path only.
8. **Each unit decides its own redaction.** Whether a value in a unit is redacted depends on that
   unit and the declared paths, never on another unit that may be read later: a unit emitted once
   is archived, and re-emitting it redacted does not take the value back. Where only another unit
   could tell (cursor-agent's model context naming a step's tool), the adapter redacts on what the
   unit itself shows, and treats a shape it does not know as secret.

## 5. What this model leaves to the consumer

The consumer owns:
- cursors, generations and the archive;
- `rev`, tombstones (or removed versions, sessions §4) and totals;
- resolving link references and merging the two sides of an edge;
- inferred cross-session links within a harness store (nominated by fingerprint, verified on full
  records);
- billing inherited usage once;
- search.

The adapter supplies units, keys, incarnations, explicit lifecycle records, fingerprints and
facets. The split is [sessions](sessions.md).

## 6. Relation to other contracts

- **harness-skeleton:** its sessions addendum, its `sessions` capability facets and its
  `sessions read` cite **sessions-model@v1**. They do not copy it.
- **[sessions-sql](https://github.com/agent-realm/sessions-sql)** maps these records to SQL tables.

## 7. Design decisions

1. **A sessions-only conformance profile.** IDE editors (Cursor, Windsurf/Devin, VS Code, Zed,
   Kiro, JetBrains) certify the sessions part only: this model and the [sessions](sessions.md)
   seam.
2. **Adapter code may live anywhere that passes conformance.** The reference adapters live in
   one place, the session-adapters package in
   [harness-skeleton](https://github.com/agent-realm/harness-skeleton); harness-skeleton's `hs`
   tool wraps it and never re-implements a reader.
3. **A session belongs to one folder on one host.** The same files read on another host, or
   under another folder, are another session. The session key is
   `(host, harness, harness_path, session_id, incarnation)` (§1), and `incarnation` only
   separates lives of one id inside one folder.
4. **"harness" is the generic word**, and "editor" names only a harness with an IDE surface.
5. **`harness_path` is the folder's real path**, not a label (§1).
6. **"harness store" is the prose noun** for what the key `store` identifies (§1). The field
   stays `harness_path`.
7. **`host` is derived from the OS machine id, never the hostname** (§1). Without a spelling
   rule, two readers on one machine could key one session twice. The rule fixes the exact input
   bytes, one path for the `r-` id, the cloner's duty to regenerate a cloned machine id (Linux
   without systemd and macOS VMs included), and the container case. Linux reads
   `/etc/machine-id` only, because `systemd-machine-id-setup` can restore an inherited D-Bus id.

## 8. v1: decided, and deferred

v1 freezes the record shape: a change a v1 reader cannot read needs v2, while an additive optional
field may come in a v1.x. The annex stays a dated, living record of observations.

**Closed lists and registries.** Every field this model defines as an enum or a fixed set of
values is one of two kinds.
- A **closed list** is final for v1. Adding a value needs v2, because a v1 reader may refuse an
  unknown value. Among them: `reuse` (§1 rule 2) and the record `type`s (§2); the session's
  `state` and `title_set_by` (§2.1); the message's `role`, `source`, `status` and `state` (§2.2);
  the part `kind`s, a `tool_result`'s `status`, and the forms of `summary.replaces` (§2.3); usage
  `granularity` and `anchor` kinds (§2.4); link `kind`, `stated_on` and `evidence` (§2.5);
  lifecycle `op` and `evidence` (§2.6).
- A **registry** grows with the harnesses the model covers, not with the model: `harness` (§1
  rule 3), the session's `ts_source` (§2.1) and raw unit `enc` (§3). A new value comes in a v1.x,
  listed in its section and in the annex. A v1 reader accepts a value it does not know, and never
  refuses a record for it:
  - an unknown `harness` is an opaque part of the key;
  - an unknown `ts_source` means the meaning of `ts` is unknown;
  - a unit with an unknown `enc` is kept as opaque bytes and not decoded.

  Removing or renaming a registry value still needs v2.

  Added since v1: `ts_source` `legacy` (v1.1, §2.1).

sessions has its own (sessions §5).

**Decided for v1:**
- **The setup a session ran under:** `setup` on the session record (§2.1).
- **Positional ids across several main sources:** qualified by the source's name from the first
  read (§1 rule 10).
- **The harness id** `reference-harness` (§1 rule 3).
- **Resume and end** stay `notice` parts, with the harness's own `native_type`. **A sub-agent's
  finish** is the spawning call's `tool_result` (same `call_id`), so it needs no record.
- **`continuation`** sharpened, with `at` a message id (§2.5).
- **Gemini's tool-use prompt tokens:** the `tool_prompt` counter (§2.4).

**Deferred out of v1:**
- joining launch records from harness-skeleton's `hs` tool onto other harnesses' sessions, which is consumer-side work;
- resume and end as lifecycle operations, until a real harness store records them;
- inferred links, which stay the consumer's (§2.5).

**Changes from the earlier drafts** (an adapter written against them re-derives):
- a usage record's `basis` became `input_includes_cache` and `output_includes_reasoning` (§2.4);
- an error part's own kind is `error_kind`, in `cmp_sha` too (§2.3);
- `tool_result` gained `exit_code`, and `output_ref` became `{ref, sha256, bytes}` (§2.3);
- a message's and a part's `source` may be null, and a part may carry its own `source` and
  `state` (§2.2, §2.3);
- the session record gained `setup`, and usage gained `tool_prompt`;
- Codex's positional ids gained their rollout file name as a qualifier: the ids change once,
  with the adapter's `adapter_ver` (§1 rule 8), and the session-adapters package's CHANGELOG
  maps old keys to new.

## Conformance (adapter side)

A session adapter may claim sessions-model@v1 only when all of these pass. Under the sessions-only
profile (§7.1), these checks and the adapter-side checks of [sessions](sessions.md) are the whole
certification. Engine-side checks live in [sessions](sessions.md).

An item that names a harness applies to that harness's adapter. CommandCode and droid have no
adapter yet (deferred on 2026-10-21), so the items that name them apply once one
exists. The session-adapters package keeps a matrix of what proves each item for each of its
harnesses (`packages/session-adapters/docs/conformance-matrix.md`).

- [ ] **Replay:** for every session fixture, `derive` from empty state over the ordered raw units
      gives the expected folded final state. Every incremental split of the same units gives the
      same final state.
- [ ] **Keys are stable:** re-deriving after a lost state gives identical keys for every record
      type.
- [ ] **File harness stores:** a harness store bound to a database file has that file's real path as
      `harness_path`. The default `opencode.db`, and `OPENCODE_DB` set to that same file, give
      one `harness_path`. `opencode.db` and `opencode-<channel>.db` give two.
- [ ] **Host:** two readers on one machine derive the same `host` from the machine id; the
      hostname (in any spelling) changes nothing, the machine id's characters are hashed exactly
      as the OS stores them (encoded as UTF-8), and a missing machine id gives the `r-` value
      persisted at the one fixed path.
      An empty or `uninitialized` `/etc/machine-id` never yields a derived `host`, even when
      `/var/lib/dbus/machine-id` holds a valid id.
- [ ] **Regenerated machine id:** on a machine whose machine id was regenerated, the reader derives
      a `host` different from the image's, and the same harness store content read on both gives
      two sessions. (A reader cannot detect a clone that kept its parent's id; the cloner's own
      check is that two machines cloned from one image report different machine ids.)
- [ ] **Known answers:** every vector in *Known-answer vectors* below gives exactly its expected
      `host` or `harness_path`, so memhouse, harness-skeleton's `hs` tool and the session-adapters module agree byte for
      byte.
- [ ] **One harness store, one session:** the same files read under two hosts are two harness
      stores and give two sessions, with the same `session_id` and different session keys.
- [ ] **Incarnation:**
      - the Copilot `--session-id` reuse fixture yields two incarnations;
      - Goose is declared `undetectable`, with `incarnation = created_at`;
      - a whole-file rewrite with the same marker yields one incarnation.
- [ ] **Anchored ids:** a truncate and regrow gives the regrown messages new keys where their
      anchor is new (`zed/restore-lab/`), and the same key, revised, where the anchor survives
      (Goose `<id>+n`, Cursor `<bubbleId>:assistant`). A pre-restore key never names two
      messages at once. `zed/restore-lab/` is a capture: Zed's restore removes the restored user
      message too, and the regrown agent messages, anchored on the new user message, never take
      a pre-restore key, while their positions are reused.
- [ ] **Tool linkage:** every `tool_call` with a result links to exactly one `tool_result` with
      the same `call_id`. A combined native part yields `<id>:call` and `<id>:result`.
- [ ] **Folding:** a harness store that repeats a native id (Gemini CLI, Devin) yields one record per key,
      in its last state.
- [ ] **Migration fold:** in `gemini-cli/rewind/`, the two identical errors stay two messages. For a CommandCode adapter, once one exists: in a migrated session, entries 5–7 fold into 2–4 as aliases, and entry 8 is re-parented to the original it copies (§1 rule 5).
- [ ] **Explicit links:** each explicit fork, subagent, rewind_copy and clear in the fixtures
      yields one link with the right kind, `stated_on`, references and `at`. `child_stored:
      false` is set where the child is missing. No inferred link is emitted. A `continuation` is
      proved by the planned `reference-harness` only, until another harness store is seen to record one.
- [ ] **`cmp_sha`:** a fork copy that re-minted ids (OpenCode `(fork #N)`) has the same `cmp_sha`
      sequence as its origin's copied prefix.
- [ ] **Retraction vs destruction:**
      - Gemini `$rewindTo` (`gemini-cli/features/`) and `$patch.removeIds` (`gemini-cli/pass3/`),
        and VS Code `kind 2` (`vscode/features/`, `vscode/lab/`), yield `state: retracted` plus a
        lifecycle record, with nothing tombstoned.
      - A Copilot rewind (`copilot-cli/rewind/`) yields a lifecycle record, and its
        rewritten-away keys disappear through `reset`.
- [ ] **Speaker split:** a VS Code request yields a user message (`requestId`) and an assistant
      message (`responseId`). A Cursor user bubble yields a user message and a
      `<bubbleId>:assistant` message with its children as parts.
- [ ] **Orphans:** the orphan transcript in `cursor-agent/orphan/` is not listed as a live
      session.
- [ ] **Compaction is not deletion:** after a summary, every replaced message is still present.
      Goose's replaced rows have `to_user: true, to_model: false`.
- [ ] **Redaction:**
      - in the sentinel-secret fixtures, the sentinel value appears in neither raw units nor
        records, and its path shows `<redacted len=N>` with the right N;
      - the free-text sentinel fixture keeps its sentinel, which documents rule 6;
      - usage counters survive;
      - the name lint reports no uncovered string;
      - a unit whose redaction another unit could decide is read alone, and its secret is
        already gone (rule 8: a cursor-agent credential step with no model-context blob yet).
- [ ] **Usage:** `input_includes_cache`, `output_includes_reasoning`, `granularity` and `anchor`
      match §2.4 and the annex; a flag §2.4 leaves null is null. A stored zero on an aborted
      step or a free plan derives to null. No two usage records of a session count the same
      tokens (§2.4), `per_record` usage aside, which no adapter emits: a Zed thread with both
      totals gives one `per_session` record. A Gemini CLI record's `tokens.tool` is
      `tool_prompt`. An adapter emits no `per_record` usage.
- [ ] **Setup:** `setup` is null unless the harness store records it. Where it does
      (the planned `reference-harness`), it holds hashes and names only, and its `digest` is the sha256 of
      the canonical JSON of its other fields.

### Known-answer vectors

The machine ids below are synthetic, not real machines. Each `host` is the first 32 hex digits of
sha256 over the UTF-8 bytes of `sessions-model/host/v0:` followed by the machine id. Every value
was computed on 2026-10-22 by three tools (Python `hashlib`, `shasum -a 256` and `openssl dgst
-sha256`), which agree.

**`host`:**

| Machine id source | Value as the OS stores it | Expected `host` |
|---|---|---|
| macOS `IOPlatformUUID` | `8F3A1C2E-5B7D-4E9F-A1B2-C3D4E5F60718` | `a9c0e0812394b435f67384b7335eb4ec` |
| Linux `/etc/machine-id` | `0f1e2d3c4b5a69788796a5b4c3d2e1f0` followed by a newline | `0d0d3eefb2fba3434590abdc952a7ef7` |
| Windows `MachineGuid` | `3d6f8a2c-9b1e-4c7d-8e5f-0a1b2c3d4e5f` | `7887e6927739c4faced8534b18da80a4` |
| Linux `/etc/machine-id` | empty (zero bytes) | no derived `host`: the `r-` value |
| Linux `/etc/machine-id` | `uninitialized` followed by a newline | no derived `host`: the `r-` value |
| Linux `/etc/machine-id` | 31 hex digits (not the OS's form) | no derived `host`: the `r-` value |
| Linux `/etc/machine-id` empty, `/var/lib/dbus/machine-id` valid | — | no derived `host`: the `r-` value (D-Bus is never read) |

Two wrong answers that a reader must not produce, because each shows a known mistake:

- `9bd6f0009abf4eb43b4bb380a9337e91` for the macOS row. That is the hash of the id lowercased, and
  the machine id takes no case change.
- `306d491e299c0cafad3f50eda755590e` for the Linux row. That is the hash with the trailing newline
  kept, and surrounding whitespace is stripped.

**`harness_path`:** each case starts from a fixture tree the test builds. `<f>` stands for the
fixture's own real path, already resolved.

| Given | Volume | Expected `harness_path` |
|---|---|---|
| a path spelled through `/tmp`, e.g. `/tmp/<…>/home` on macOS, where `/tmp` is a symlink to `/private/tmp` | any macOS | `/private/tmp/<…>/home` |
| `<f>/link`, a symlink to `<f>/real/Claude-Home` | any | `<f>/real/Claude-Home` |
| `<f>/real/claude-home`, where the folder was created as `Claude-Home` | case-insensitive (APFS, HFS+ by default) | `<f>/real/Claude-Home` (the on-disk case) |
| `<f>/real/Claude-Home/` | any | `<f>/real/Claude-Home` (no trailing slash) |
| `<f>/real/./Claude-Home` | any | `<f>/real/Claude-Home` |
| `<f>/a/.claude` and `<f>/a/.Claude`, both created | case-sensitive (Linux ext4) | two different values, unchanged (no case folding) |

The first five rows were run on macOS APFS with Node's `fs.realpathSync.native` on 2026-10-22, and
each gave the expected value. The last row was run on Linux (GitHub-hosted ubuntu-latest, Node 22,
`fs.realpathSync.native`) in the reference provider's CI, and passed.

## Annex

The informative annex is [sessions-model-annex.md](sessions-model-annex.md). It holds:
- the per-harness mapping: 17 rows, with `reuse` and the birth-marker field for each;
- each harness's gaps;
- where the conformance cases and their fixtures live (annex §3);
- the cross-harness observations this model was revised against.
