# ASSIMILATOR

ASSIMILATOR is a local-first converter and browsing workspace.

Its core job is simple:

```txt
anything useful -> Markdown + HTML
```

You can use it from:

- a local web app with drag-and-drop file upload and URL input
- an agent-friendly CLI with flags
- an interactive terminal UI
- a Telegram bot gateway that accepts URLs and uploaded files

The main output is saved under `knowledge-system/converted/`. The optional wiki/portal commands let you browse imported material as a local static knowledge portal.

## What It Does

ASSIMILATOR converts files and URLs into:

- `.md` Markdown
- `.html` rendered HTML
- `.json` metadata

It can also optionally:

- preserve raw sources
- ingest converted material into a local workspace
- render a browsable portal
- search converted/wiki material
- inventory a book library without ingesting all books

## Install

Requirements:

- Node.js
- pnpm
- Python 3 for optional Microsoft MarkItDown fallback

Install Node dependencies:

```bash
pnpm install
```

Install optional Python conversion tools:

```bash
pnpm setup:python-tools
```

This creates:

```txt
.venv/
```

and installs:

```txt
python/requirements.txt
```

## Quick Test

Run all basic checks:

```bash
pnpm -s typecheck
pnpm -s test
pnpm --filter @assimilator/cli build
pnpm smoke
```

## Web App

Start the local web converter:

```bash
pnpm web
```

Open:

```bash
open http://localhost:4321
```

The web app lets you:

- drag and drop files
- choose files with a file picker
- paste URLs
- convert to Markdown
- preview HTML
- copy Markdown
- download Markdown
- download HTML

Saved results go to:

```txt
knowledge-system/converted/
```

Example output:

```txt
knowledge-system/converted/
  youtube/
    10-weird-oss-projects-you-need-right-now/
      10-weird-oss-projects-you-need-right-now.md
      10-weird-oss-projects-you-need-right-now.html
      10-weird-oss-projects-you-need-right-now.json
  web/
    example-domain/
      example-domain.md
      example-domain.html
      example-domain.json
  markdown/
    my-note/
      my-note.md
      my-note.html
      my-note.json
```

## CLI: Pure Conversion

Use `convert` when you only want Markdown and HTML output.

Convert a file:

```bash
pnpm assimilate convert --file ./document.pdf
```

Convert a URL:

```bash
pnpm assimilate convert --url "https://example.com/article"
```

Convert a YouTube video:

```bash
pnpm assimilate convert --url "https://www.youtube.com/watch?v=qPuzWFvRajk"
```

Print Markdown to stdout:

```bash
pnpm assimilate convert --file ./document.docx --print markdown
```

Print HTML to stdout:

```bash
pnpm assimilate convert --file ./document.docx --print html
```

Save to a custom output directory:

```bash
pnpm assimilate convert --file ./document.pdf --output-dir ./out
```

Suppress progress output:

```bash
pnpm assimilate convert --url "https://example.com" --quiet
```

Progress messages go to `stderr`. JSON, Markdown, or HTML output stays on `stdout`, so agents can parse it safely.

## Interactive Terminal UI

Run:

```bash
pnpm assimilate tui
```

Then choose:

- Convert file
- Convert URL
- Quit

The TUI saves output in the same `knowledge-system/converted/` structure.

## Telegram Bot

Run the Telegram gateway when you want to send ASSIMILATOR a URL or file from Telegram and receive the generated Markdown and HTML back in chat.

Create a bot with BotFather, then start the service with the token in the environment:

```bash
BOT_key="<telegram-bot-token>" pnpm telegram
```

Accepted token variables:

```txt
BOT_key
BOT_KEY
TELEGRAM_BOT_TOKEN
```

Optional workspace override:

```bash
ASSIMILATOR_WORKSPACE="/path/to/knowledge-system" BOT_key="..." pnpm telegram
```

Telegram commands:

```txt
/help
/commands
/convert_url https://example.com/article
/convert_url https://www.youtube.com/watch?v=VIDEO_ID
/convert_file
/status
/search markdown
/ask what did I save about markdown?
/health
/render_portal
/compile_wiki
/process_inbox
/memory_export
/daily_log note for today
```

You can also paste a normal URL as a message. For files, upload a document after `/convert_file` or just upload the document directly.

The bot saves results under the same conversion tree used by CLI and web:

```txt
knowledge-system/converted/
```

Then it sends back:

```txt
<title>.md
<title>.html
<title>.json
```

Notes:

- Telegram upload/download size limits still apply.
- The bot runs locally on the machine where ASSIMILATOR is installed.
- Private files stay local except for the Telegram message/file transport itself.

## Supported Input Types

ASSIMILATOR uses multiple converters. Support depends on the input type and the available extraction path.

### Markdown

```bash
pnpm assimilate convert --file ./notes.md
```

Output:

```txt
knowledge-system/converted/markdown/notes/notes.md
knowledge-system/converted/markdown/notes/notes.html
knowledge-system/converted/markdown/notes/notes.json
```

### Text

```bash
pnpm assimilate convert --file ./notes.txt
```

### HTML

HTML is converted to Markdown with Showdown, then rendered back to HTML.

```bash
pnpm assimilate convert --file ./page.html
```

### PDF

```bash
pnpm assimilate convert --file ./report.pdf
```

### Word

```bash
pnpm assimilate convert --file ./document.docx
```

### PowerPoint

```bash
pnpm assimilate convert --file ./slides.pptx
```

### Excel

```bash
pnpm assimilate convert --file ./spreadsheet.xlsx
```

### CSV / TSV

```bash
pnpm assimilate convert --file ./data.csv
pnpm assimilate convert --file ./data.tsv
```

### JSON

```bash
pnpm assimilate convert --file ./config.json
```

### YAML

```bash
pnpm assimilate convert --file ./schema.yaml
```

### XML

```bash
pnpm assimilate convert --file ./feed.xml
```

### EPUB / Books

```bash
pnpm assimilate convert --file ./book.epub
```

For large libraries, inventory first:

```bash
pnpm assimilate inventory-library ~/Books
```

This writes an inventory without ingesting all book text.

### Images

```bash
pnpm assimilate convert --file ./screenshot.png
pnpm assimilate convert --file ./photo.jpg
```

Image metadata can usually be extracted locally. AI image description/OCR may require provider configuration depending on the converter path.

### Audio

```bash
pnpm assimilate convert --file ./recording.mp3
```

Audio transcription is not guaranteed to be local/no-key. `markit-ai` media transcription is LLM-backed and may require:

```bash
OPENAI_API_KEY=...
# or
ANTHROPIC_API_KEY=...
```

### ZIP

```bash
pnpm assimilate convert --file ./archive.zip
```

ZIP support depends on the converter path and the files inside the archive.

### Generic URLs

```bash
pnpm assimilate convert --url "https://example.com/article"
```

Output usually goes under:

```txt
knowledge-system/converted/web/<page-title>/
```

### YouTube URLs

```bash
pnpm assimilate convert --url "https://www.youtube.com/watch?v=qPuzWFvRajk"
```

ASSIMILATOR first uses packaged `yt-dlp` to extract subtitles or auto subtitles.

Output goes under:

```txt
knowledge-system/converted/youtube/<video-title>/
```

If no usable transcript is found, ASSIMILATOR fails instead of saving a generic YouTube webpage as fake transcript text.

## Converter Chain

ASSIMILATOR does not rely on one converter.

Current chain:

```txt
Markdown/TXT/HTML
-> local adapters

Rich local files
-> markit-ai
-> Microsoft MarkItDown fallback

YouTube URLs
-> packaged yt-dlp transcript extraction
-> Microsoft MarkItDown fallback if installed

Generic URLs
-> markit-ai
-> Microsoft MarkItDown fallback

Markdown to HTML
-> Showdown
```

## Dependencies

Root app dependencies:

- `express`: local web server
- `multer`: file upload handling
- `cors`: local API support
- `node-telegram-bot-api`: Telegram bot polling, commands, file download, and document replies
- `vite` / `@vitejs/plugin-react`: frontend tooling currently available for future web app expansion

CLI dependencies:

- `commander`: CLI command routing
- `ink`, `react`, `ink-text-input`, `ink-select-input`: terminal UI
- `markit-ai`: broad file and URL to Markdown conversion
- `showdown`: Markdown to HTML and HTML to Markdown
- `jsdom`: DOM bridge for Showdown HTML to Markdown in Node
- `yt-dlp-exec`: packaged `yt-dlp` for YouTube transcript extraction
- `gray-matter`: Markdown frontmatter parsing
- `yaml`: YAML config support
- `zod`: schema validation
- `tsx`: TypeScript execution during development

Python optional tools:

- `markitdown[all]`: Microsoft MarkItDown fallback converter

Install with:

```bash
pnpm setup:python-tools
```

## Workspace Layout

Default workspace:

```txt
knowledge-system/
```

Important folders:

```txt
knowledge-system/
  converted/          # pure conversion outputs: md/html/json
  raw/                # preserved raw sources from ingest commands
  processed/          # processed Markdown and metadata from ingest commands
  wiki/               # optional canonical wiki pages
  portal/             # optional rendered portal
  memory/             # optional exported memory cards
  logs/               # ingestion and health logs
```

For the main converter use case, look here:

```txt
knowledge-system/converted/
```

## Ingest Mode

Use `ingest-*` commands when you want conversion plus raw preservation, metadata, wiki pages, and indexes.

Initialize workspace:

```bash
pnpm assimilate init
```

Ingest one file:

```bash
pnpm assimilate ingest-file ./report.pdf --tag research
```

Ingest a folder:

```bash
pnpm assimilate ingest-folder ./notes
```

Ingest a URL:

```bash
pnpm assimilate ingest-url "https://example.com/article"
```

Ingest a YouTube URL:

```bash
pnpm assimilate ingest-youtube "https://www.youtube.com/watch?v=qPuzWFvRajk"
```

Process inbox:

```bash
pnpm assimilate process-inbox
```

Inbox location:

```txt
knowledge-system/inbox/drop/
```

## Portal

The portal is optional. It is for browsing ingested/wiki material.

Render portal:

```bash
pnpm assimilate render-portal
```

Open:

```bash
open knowledge-system/portal/public/index.html
```

Portal output:

```txt
knowledge-system/portal/public/index.html
knowledge-system/portal/pages/
knowledge-system/portal/search-index/pages.json
```

The portal includes:

- dashboard
- page counts
- type counts
- recent pages
- client-side search

## Search And Ask

Search local Markdown/wiki:

```bash
pnpm assimilate search "Hermes memory"
```

Ask with local evidence only:

```bash
pnpm assimilate ask "What do we know about Hermes memory?"
```

`ask` does not call an LLM. It returns local source-linked matches.

## Health Check

Run:

```bash
pnpm assimilate health-check
```

Reports are written to:

```txt
knowledge-system/logs/health-checks/
```

Health output includes:

- errors
- warnings
- info / curation notes

Example:

```txt
Issues: 17 (0 errors, 0 warnings, 17 info)
```

Info items are often normal for generated pages that still need review.

## Common Workflows

### Convert A PDF And Open HTML

```bash
pnpm assimilate convert --file ./report.pdf
open knowledge-system/converted/pdf/report/report.html
```

### Convert A YouTube Video

```bash
pnpm assimilate convert --url "https://www.youtube.com/watch?v=qPuzWFvRajk"
open knowledge-system/converted/youtube/10-weird-oss-projects-you-need-right-now/10-weird-oss-projects-you-need-right-now.html
```

### Use The Web UI

```bash
pnpm web
open http://localhost:4321
```

### Use The Telegram Bot

```bash
BOT_key="<telegram-bot-token>" pnpm telegram
```

Then send the bot:

```txt
/convert_url https://example.com/article
```

or upload a file.

### Use It From An Agent

Get JSON paths:

```bash
pnpm assimilate convert --file ./report.pdf --quiet
```

Get Markdown directly:

```bash
pnpm assimilate convert --file ./report.pdf --print markdown --quiet
```

Get HTML directly:

```bash
pnpm assimilate convert --file ./report.pdf --print html --quiet
```

## Troubleshooting

### YouTube Saves A Generic Page

This should now be blocked. YouTube conversion must produce a usable transcript or fail.

Use:

```bash
pnpm assimilate convert --url "https://www.youtube.com/watch?v=VIDEO_ID"
```

If it fails, the video may not have captions or auto captions available.

### Audio Needs A Key

Audio transcription usually requires an external transcription provider.

For `markit-ai`, configure:

```bash
OPENAI_API_KEY=...
```

or:

```bash
ANTHROPIC_API_KEY=...
```

### Microsoft MarkItDown Is Missing

Install project-local Python tools:

```bash
pnpm setup:python-tools
```

Or point to a custom binary:

```bash
ASSIMILATOR_MARKITDOWN_BIN="/path/to/markitdown" pnpm assimilate convert --file ./report.pdf
```

### Use A Custom yt-dlp Binary

ASSIMILATOR includes `yt-dlp` through `yt-dlp-exec`, but you can override it:

```bash
ASSIMILATOR_YTDLP_BIN="/path/to/yt-dlp" pnpm assimilate convert --url "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Clean Bad Old Generated Outputs

Generated conversion outputs are safe to delete if they are wrong or stale.

Example:

```bash
rm knowledge-system/converted/youtube/youtube.md \
   knowledge-system/converted/youtube/youtube.html \
   knowledge-system/converted/youtube/youtube.json
```

## Development

Run tests:

```bash
pnpm -s test
```

Typecheck:

```bash
pnpm -s typecheck
```

Build CLI:

```bash
pnpm --filter @assimilator/cli build
```

Run smoke test:

```bash
pnpm smoke
```

## Current Project Status

Implemented:

- local web converter
- file upload conversion
- URL conversion
- Telegram bot conversion gateway
- YouTube transcript extraction with packaged `yt-dlp`
- Markdown output
- HTML output
- JSON metadata output
- CLI conversion command
- interactive Ink TUI
- optional ingest/wiki/portal workflow
- project-managed MarkItDown fallback setup

Not yet a public SaaS:

- no user accounts
- no hosted deployment
- no background job queue
- no full OCR pipeline UI
- no local speech-to-text engine bundled
