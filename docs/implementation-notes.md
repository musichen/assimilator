# Implementation Notes

## First Implementation Slice

The first runnable ASSIMILATOR slice implements the local knowledge loop:

```txt
init workspace
-> ingest local TXT/MD/HTML
-> preserve raw source
-> write metadata and normalized Markdown
-> compile wiki source pages and indexes
-> render HTML portal with Showdown
-> search Markdown/wiki
-> export Hermes/Hindsight memory cards
-> run health checks
```

## Completed MVP Command Surface

Implemented commands:

- `init`
- `status`
- `convert`
- `ingest`
- `ingest-url`
- `ingest-youtube`
- `ingest-file`
- `ingest-folder`
- `ingest-book`
- `ingest-image`
- `ingest-repo`
- `process-inbox`
- `compile-wiki`
- `render-portal`
- `search`
- `ask`
- `health-check`
- `suggest-concepts`
- `suggest-links`
- `daily-log`
- `memory-export`
- `hindsight-export`
- `inventory-library`

Implemented apps:

- local web converter at `pnpm web`
- Ink TUI at `pnpm assimilate tui`

## Remaining Product Depth

The CLI MVP is complete. The remaining work is product hardening rather than missing command coverage:

- privacy-gated external LLM enrichment
- dedicated Next.js portal app
- SQLite FTS index
- richer YouTube transcript extraction
- higher-fidelity URL clipping
- review UI for memory cards
- richer health auto-fixes

## Reference Projects

`_reference_projects/markit` and `_reference_projects/showdown` were temporary local references. Their ideas are integrated through project code and dependencies, not runtime links to the reference folders.

Current state:

- Showdown is used bidirectionally: Markdown to HTML for portal rendering and HTML to Markdown for local HTML ingestion.
- Markit is available through the `markit-ai` dependency for richer local files.
- The MVP converter handles Markdown, text, and Showdown-backed HTML locally before falling through to Markit.
- `ASSIMILATOR_MARKIT_BIN` remains as an optional debugging override for a Markit-compatible command.

## Privacy

The default workspace config uses `local_first` and `private`. No external LLM calls are made by the current implementation.

Markit image/audio LLM prompts are not wired into ASSIMILATOR yet. That is deliberate until privacy-mode gates exist for external processing.
