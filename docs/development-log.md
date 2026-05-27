# ASSIMILATOR Development Log

This log records the project evolution so future coding agents can understand why the system looks the way it does.

## 2026-05-27

### Product Direction Clarified

- Re-centered ASSIMILATOR around universal conversion: files and URLs to Markdown and HTML.
- Kept wiki, portal, search, and memory export as additional knowledge-base layers, not the core product promise.
- Confirmed the main output location as `knowledge-system/converted/`.

### Repository Skeleton And Workspace

- Added PNPM workspace structure.
- Added TypeScript configuration.
- Added ASSIMILATOR workspace initialization.
- Added `knowledge-system/` folder structure for converted, raw, processed, wiki, portal, memory, and logs.
- Added config and schema validation foundations.

### CLI MVP

- Added `pnpm assimilate` command.
- Added `init`, `status`, `convert`, `ingest-*`, `process-inbox`, `compile-wiki`, `render-portal`, `search`, `ask`, `health-check`, `memory-export`, `daily-log`, and `inventory-library` commands.
- Added agent-friendly `convert` flags:
  - `--file`
  - `--url`
  - `--output-dir`
  - `--title`
  - `--print markdown|html|json`
  - `--quiet`
- Added progress output to `stderr` so agents can parse `stdout`.

### Conversion Core

- Added shared `convertAnything` service in `apps/cli/src/core/convert.ts`.
- Standardized conversion output as Markdown, HTML, and JSON metadata.
- Added title-based output folders under `knowledge-system/converted/<category>/<title>/`.
- Added Markdown to HTML rendering through Showdown.

### Converter Integrations

- Added local Markdown, text, and HTML conversion adapters.
- Added `markit-ai` adapter for rich file and URL conversion.
- Added project-local Microsoft MarkItDown fallback through `python/requirements.txt` and `pnpm setup:python-tools`.
- Added Showdown adapter for Markdown to HTML and HTML to Markdown support.
- Added packaged `yt-dlp-exec` dependency for YouTube transcript extraction.
- Added strict YouTube behavior: fail when no usable transcript exists instead of saving generic YouTube website text.
- Added escaped-shell-URL normalization for URLs like `watch\?v\=...`.

### Web App Gateway

- Added Express web server in `apps/web/server.ts`.
- Added static browser UI in `apps/web/public/`.
- Added drag-and-drop file conversion.
- Added URL conversion.
- Added Markdown preview, HTML preview, copy, and download flows.
- Added `/api/convert/file`, `/api/convert/url`, and `/api/conversions`.

### Interactive TUI Gateway

- Added Ink TUI in `apps/cli/src/tui/app.tsx`.
- Added conversion choices for file and URL input.
- Reused the shared conversion core and output tree.

### Ingest, Wiki, Portal, Search, Memory

- Added raw-preserving ingest commands.
- Added processed Markdown artifacts.
- Added wiki source pages and index refresh.
- Added static portal rendering from wiki Markdown.
- Added simple local search and local-evidence `ask`.
- Added memory-card JSONL export.
- Added health-check reports in Markdown and JSON.

### Documentation

- Expanded `README.md` into a full user manual.
- Added `docs/cli-reference.md`.
- Added `docs/converter-strategy.md`.
- Added `docs/implementation-notes.md`.
- Added `docs/architecture.md` for future coding agents.
- Added this `docs/development-log.md`.

### Telegram Gateway

- Added `node-telegram-bot-api`.
- Added `pnpm telegram`.
- Added `apps/telegram/bot.ts`.
- Bot token is read from `BOT_key`, `BOT_KEY`, or `TELEGRAM_BOT_TOKEN`.
- Optional workspace is read from `ASSIMILATOR_WORKSPACE`.
- Added slash commands:
  - `/start`
  - `/help`
  - `/commands`
  - `/convert_url`
  - `/convert_file`
  - `/status`
  - `/search`
  - `/ask`
  - `/health`
  - `/render_portal`
  - `/compile_wiki`
  - `/process_inbox`
  - `/memory_export`
  - `/daily_log`
- Added document upload handling.
- Added plain-text URL detection.
- Bot saves generated files under the normal `knowledge-system/converted/` tree.
- Bot sends Markdown, HTML, and JSON metadata files back to the requester.

## Current State

ASSIMILATOR now has three practical gateways:

```txt
1. Web app
2. CLI / TUI
3. Telegram bot
```

All three use the same conversion core and save to the same workspace.

## Remaining Product Opportunities

- Add background job queue for long conversions.
- Add local speech-to-text fallback for audio without external API keys.
- Add stronger OCR pipeline controls for images and scanned PDFs.
- Add richer portal browsing for `knowledge-system/converted/` outputs, not only wiki pages.
- Add optional authentication or allowlist controls for Telegram chat IDs.
- Add persistent conversion history with retry status.
- Add MCP/server API gateway for agents.
