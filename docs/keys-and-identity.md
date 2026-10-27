# Keys and identity

Every record names the session it belongs to with the same five fields, and every record type
adds one key of its own. Getting these right is what lets two readers on two machines agree.

## The session key

`(host, harness, harness_path, session_id, incarnation)`, carried by every record (sessions-model §1).

- **`host`** names the machine, derived from the OS machine id. It is the first 32 lowercase hex
  digits of sha256 over the UTF-8 bytes of `sessions-model/host/v0:` followed by the machine id,
  taken exactly as the OS stores it (trimmed, no case change). It is never the hostname: one Mac
  answers as `my-laptop`, `my-laptop.local` or a fully qualified name, and a rename changes it.
  Where no machine id can be read, `host` is `r-` plus a random 128-bit id persisted at one fixed
  per-user path. A harness store kept by a service rather than on a machine (claude.ai's
  conversations, read from an export) has `host` = `s-` plus the first 32 hex digits of sha256 over
  `sessions-model/service-host/v0:` and the lowercase domain, and the service's origin
  (`https://claude.ai`) as `harness_path`, so every importer lands on one key (v1.3).
- **`harness`** is one value from a registry (`claude-code`, `codex`, `gemini-cli`, `opencode`,
  `zed`, …). The registry grows in v1.x with the harnesses the model covers, and a v1 reader
  accepts a value it does not know (sessions-model §8).
- **`harness_path`** is the real path of the data folder the harness is bound to, or of one
  database file it keeps as a store of its own: absolute, symlinks resolved, in the case the
  filesystem stores, no trailing slash.
- **`session_id`** is the harness's native id.
- **`incarnation`** separates two lives of one id inside one data folder, where a harness can reuse
  an id. It is `''` where ids are never reused.

The first three together are the **harness store**: the conversation data of one harness bound to
one `harness_path` on one host. In JSON they travel as the object `store`. One host holds many
harness stores, which is why `host` alone is not enough.

**There is no "same session" across harness stores.** The same files copied to another machine,
or read under another folder, are another session with the same `session_id`.

## Record keys

| Record | Key |
|---|---|
| session | the session key itself |
| message | `message_id`: the native id, else an anchored id (`<anchor_id>+n`), else a positional id |
| usage | `usage_id`: the native id, else `<anchor>#n` |
| link | `(kind, the other side's reference, at)` |
| lifecycle | `lifecycle_id`: the native id, else a derived one |

Rules that keep keys stable (sessions-model §1):
- **Nothing volatile in a key.** A key never carries what a rewrite or a re-read can change, such
  as a file's modification time or the time it was read. A time the harness store itself keeps
  fixed may appear: Goose's session ids begin with a UTC date, and its `incarnation` is the
  session's `created_at` (sessions-model §1 rule 2).
- **No content in a key.** Content changes are revisions of the same key, seen through
  `content_sha` and `cmp_sha`.
- **An anchored key names a position after its anchor**, not the content there. A reply regrown
  under a surviving anchor keeps its key and is revised; a new anchor gives new keys.
- **Positional ids are the last resort.** Where a session can have more than one main source, the
  position is qualified by the source's name, so a second source never re-keys the first.

## Checking your implementation

The contract's conformance section carries **known-answer vectors**: given machine ids with their
exact `host`, and paths with their exact `harness_path`. Run your implementation against them before
anything else.
