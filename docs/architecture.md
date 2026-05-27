# ASSIMILATOR Architecture

ASSIMILATOR is built around one rule:

```txt
source input -> Markdown -> HTML + metadata
```

The project has multiple gateways, but they all call the same conversion core. This keeps CLI, web, TUI, and Telegram behavior consistent.

## Entry Points

```txt
apps/cli/src/index.ts       CLI command router
apps/cli/src/tui/app.tsx    Ink interactive terminal UI
apps/web/server.ts          Local web API and static web app
apps/web/public/            Browser UI assets
apps/telegram/bot.ts        Telegram bot gateway
```

Primary scripts:

```bash
pnpm assimilate
pnpm assimilate convert --file ./report.pdf
pnpm web
pnpm telegram
pnpm smoke
```

## Core Conversion Path

The shared converter lives here:

```txt
apps/cli/src/core/convert.ts
```

It accepts:

```ts
{
  filePath?: string;
  url?: string;
  title?: string;
  workspace: string;
  save?: boolean;
  outputDir?: string;
  onProgress?: (message: string) => void;
}
```

It returns Markdown, HTML, source metadata, and saved artifact paths.

Default saved output:

```txt
knowledge-system/converted/<category>/<title>/<title>.md
knowledge-system/converted/<category>/<title>/<title>.html
knowledge-system/converted/<category>/<title>/<title>.json
```

Categories are derived from source type. YouTube output is always nested under the video title:

```txt
knowledge-system/converted/youtube/<video-title>/<video-title>.md
```

## Converter Adapters

```txt
apps/cli/src/converters/source-converter.ts
apps/cli/src/converters/remote-converter.ts
apps/cli/src/converters/youtube.ts
apps/cli/src/converters/markit.ts
apps/cli/src/converters/markitdown.ts
apps/cli/src/converters/showdown.ts
```

Current chain:

```txt
Markdown, TXT, HTML
  -> local adapters

PDF, DOCX, PPTX, XLSX, EPUB, images, audio, archives, rich files
  -> markit-ai
  -> project-local Microsoft MarkItDown fallback

YouTube URLs
  -> packaged yt-dlp transcript extraction
  -> project-local Microsoft MarkItDown fallback

Generic URLs
  -> markit-ai
  -> project-local Microsoft MarkItDown fallback

Markdown -> HTML
  -> Showdown
```

YouTube is deliberately strict. If no usable transcript is available, the converter fails instead of saving a generic YouTube shell page as transcript content.

## Gateways

### CLI

The CLI is the most agent-friendly gateway.

```bash
pnpm assimilate convert --file ./report.pdf --quiet
pnpm assimilate convert --url "https://example.com/article" --print markdown --quiet
```

Progress is written to `stderr`; machine-readable output remains on `stdout`.

### TUI

The Ink app is a human terminal UI. It calls the same `convertAnything` core and saves to the same conversion tree.

```bash
pnpm assimilate tui
```

### Web

The web gateway is an Express server with a static browser UI.

API routes:

```txt
POST /api/convert/file
POST /api/convert/url
GET  /api/conversions
```

The web app is local-first and writes to the configured workspace.

### Telegram

The Telegram gateway runs as a local polling bot.

```bash
BOT_key="<telegram-bot-token>" pnpm telegram
```

It accepts:

```txt
/convert_url <url>
uploaded documents/files
plain messages containing URLs
```

It saves Markdown, HTML, and JSON metadata under `knowledge-system/converted/`, then sends those files back to the requester.

It also exposes operational slash commands:

```txt
/status
/search
/ask
/health
/render_portal
/compile_wiki
/process_inbox
/memory_export
/daily_log
```

## Workspace Model

The default workspace is:

```txt
knowledge-system/
```

Important folders:

```txt
converted/    Pure conversion output for web, CLI, TUI, and Telegram
raw/          Preserved source copies from ingest commands
processed/    Processed Markdown and metadata from ingest commands
wiki/         Optional Obsidian-compatible wiki
portal/       Optional rendered HTML portal
memory/       Optional memory-card exports
logs/         Ingestion, processing, and health logs
```

`converted/` is the primary product output for the current app. `raw/`, `processed/`, `wiki/`, `portal/`, and `memory/` are the broader knowledge-base pipeline.

## Ingest And Wiki Pipeline

Ingest commands are separate from pure conversion.

```txt
apps/cli/src/core/ingest.ts
apps/cli/src/wiki/indexes.ts
apps/cli/src/portal/render.ts
apps/cli/src/memory/export.ts
apps/cli/src/health/checker.ts
```

Ingest mode:

```txt
source -> raw/ -> processed/markdown -> wiki/ -> portal/search/memory
```

Pure conversion mode:

```txt
source -> converted/
```

Do not mix these responsibilities without a deliberate product decision.

## Dependency Boundaries

Keep converters behind adapter files. Gateways should not call `markit-ai`, `yt-dlp`, Showdown, or MarkItDown directly.

Good:

```txt
gateway -> convertAnything -> converter adapters
```

Avoid:

```txt
gateway -> yt-dlp / markit-ai / filesystem layout
```

This lets future agents swap converter behavior without breaking every user interface.

## Privacy And Safety

ASSIMILATOR is local-first.

Rules for future agents:

- Do not delete raw sources.
- Do not upload private source text to external services unless config allows it.
- Do not store secrets in repo files.
- Keep bot tokens in environment variables.
- Keep generated HTML derived from Markdown, never the only knowledge copy.
- Log failures clearly without leaking private full text.

## Testing And Verification

Run:

```bash
pnpm -s typecheck
pnpm -s test
pnpm --filter @assimilator/cli build
pnpm smoke
```

Telegram requires a real bot token and network access:

```bash
BOT_key="..." pnpm telegram
```

Manual Telegram verification:

1. Send `/help`.
2. Send `/convert_url https://example.com`.
3. Upload a small `.txt`, `.md`, or `.pdf`.
4. Confirm `.md`, `.html`, and `.json` files are returned.
5. Confirm matching files exist under `knowledge-system/converted/`.
