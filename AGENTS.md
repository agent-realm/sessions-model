# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Gemini CLI, and others) working in this
repository.

## What this repo is

Two contracts and their vocabulary: `contracts/sessions-model.md`, `contracts/sessions.md`,
`contracts/sessions-model-annex.md` and `TERMINOLOGY.md`, plus guides in `docs/` and example
records in `examples/`. There is no code to build; `examples/generate.mjs` is the one script.

## Docs and examples

- A guide in `docs/` explains a contract and never overrides it: where they differ, fix the guide.
- Every example in `examples/` must stay valid. After changing one, regenerate and validate:
  `node examples/generate.mjs <path to session-adapters> examples`, which must report
  `ALL VALID`. The script uses the provider's own `seal()` and `validateSession()`.
- Examples are synthetic. Use the contract's known-answer `host`, and never data from a real
  machine.

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
