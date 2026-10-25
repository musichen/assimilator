# Contributing to ASSIMILATOR

## Setup

Requirements and install steps are in the [README](README.md): Node.js, `pnpm`, and Python 3 for the optional MarkItDown fallback.

```bash
pnpm install
pnpm setup:python-tools
```

## Checks

Run these before opening a pull request (all are defined in `package.json`):

```bash
pnpm test
pnpm typecheck
pnpm smoke
```

`pnpm test` runs the Vitest suite, `pnpm typecheck` runs `tsc --noEmit`, and `pnpm smoke` runs `scripts/smoke-all.ts`.

## Try the surfaces

- CLI: `pnpm assimilate convert --file ./document.pdf`
- Web app: `pnpm web`
- Telegram bot: `pnpm telegram` (needs `.env`, see the README bot section)

## Pull requests

Create a branch from `main`, keep the change focused, and describe which surface you tested (CLI, web, TUI, or Telegram) in the PR.
