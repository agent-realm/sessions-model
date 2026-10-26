# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Gemini CLI, and others) working in this
repository.

## What this repo is

Two contracts and their vocabulary: `contracts/sessions-model.md`, `contracts/sessions.md`,
`contracts/sessions-model-annex.md` and `TERMINOLOGY.md`, plus guides in `docs/` and example
records in `examples/`. There is no code to build. `examples/generate.mjs` regenerates the
examples; `scripts/guard.mjs` and `scripts/check-tutorial.mjs` are checks; CI runs all three.

## Docs and examples

- A guide in `docs/` explains a contract and never overrides it: where they differ, fix the guide.
- Every example in `examples/` must stay valid. After changing one, regenerate and validate:
  `node examples/generate.mjs <path to session-adapters> examples`, which must report
  `ALL VALID`. The script uses the provider's own `seal()` and `validateSession()`.
- Examples are synthetic. Use the contract's known-answer `host`, and never data from a real
  machine.

## Checks (CI runs both on pull requests into `main` and on every push to `main`)

- **The guard:** run `node scripts/guard.mjs --commits origin/main..HEAD` before you push; it must
  print `guard: clean`. A pushed branch of a public repo is already published.
  - It checks the tracked files' paths and lines, and each commit's author and committer names,
    message, every path it touches and every line it adds, for private detail: credential shapes,
    home paths with a user name (outside web URLs), private IP addresses, e-mail addresses other
    than noreply and example ones, machine numbers, and process wording. It also fails a contract
    whose H1 carries no version. Commit author and committer addresses may be any GitHub-account
    address.
  - It prints file and line, or commit, never the matched text of a line. A hit in a path prints
    the path.
  - A false positive in a pattern check goes into its `ALLOW` list, in a pull request of its own:
    CI runs the base branch's copy of the guard, which also scans that pull request, so write the
    new pattern so that it does not match itself (escape a character, as the existing entry does).
    Never reword correct text to pass the guard.
  - The maintainer also runs it with `--names <file>`, a local list of names that never enters the
    repository in any form.
  - `node scripts/guard.mjs --self-test` runs the guard's own cases. Add a case with every fix to a
    check.
- **The examples and the tutorial:** use harness-skeleton's `packages/session-adapters` at the ref
  pinned in `.github/workflows/ci.yml`, and give the package as an absolute path.
  - `node examples/generate.mjs <package> examples` must report `ALL VALID` and change or add no
    file.
  - `node scripts/check-tutorial.mjs <harness-skeleton>` must validate cleanly and match
    `examples/01-one-message`.

## The rules

- **Contract changes are proposals.** Propose a change to a contract as an issue, or as a pull
  request that says it is a proposal; the maintainer decides it.
- **TERMINOLOGY.md defines the contracts' words.** A new term enters it together with the
  contract change that needs it.
- **Cite, never copy.** Another project cites a contract by name and version
  (`sessions-model@v1`); it does not paste it.
- **Versions.** v1 is frozen: a change that a v1 reader cannot read needs v2. An additive optional
  field may come in a v1.x.
- **No private detail.** Do not add hostnames, IP addresses, machine ids, credentials, or
  reproduction steps for security issues. Examples use neutral names (`my-laptop`, "a lab VM").
- **Branches.** Work on a branch named `<agent>/<description>` (for example
  `claude/annex-zed-notes`), never on `main`.

## Install and deploy

Nothing to install or deploy: this repo is documents only. Implementations live in the projects
the README lists.
