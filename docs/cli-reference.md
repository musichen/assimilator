# ASSIMILATOR CLI Reference

ASSIMILATOR is currently CLI-first and local-only. Markdown remains canonical; HTML portal pages and memory cards are derived outputs.

## Install

```bash
pnpm install
pnpm --filter @assimilator/cli build
```

## Test Everything

Run automated checks:

```bash
pnpm -s typecheck
pnpm -s test
pnpm --filter @assimilator/cli build
pnpm smoke
```

Run the full command surface manually against a temporary workspace:

```bash
TMPDIR=$(mktemp -d)
WORKSPACE="$TMPDIR/knowledge-system"
mkdir -p "$TMPDIR/notes" "$TMPDIR/books" "$TMPDIR/repo"
printf '# Hermes Memory\n\nHermes memory should stay source-linked.\n' > "$TMPDIR/notes/memory-note.md"
printf '<h1>HTML Import</h1><p><strong>Showdown</strong> converts HTML.</p>' > "$TMPDIR/notes/article.html"
printf 'sample book' > "$TMPDIR/books/Ada Lovelace - Computing Notes.epub"
printf '# Repo Knowledge\n\nASSIMILATOR can ingest local repo notes.\n' > "$TMPDIR/repo/README.md"

pnpm assimilate --workspace "$WORKSPACE" init
pnpm assimilate --workspace "$WORKSPACE" status
pnpm assimilate --workspace "$WORKSPACE" ingest-file "$TMPDIR/notes/memory-note.md" --tag hermes
pnpm assimilate --workspace "$WORKSPACE" ingest-folder "$TMPDIR/notes"
pnpm assimilate --workspace "$WORKSPACE" ingest-book "$TMPDIR/books/Ada Lovelace - Computing Notes.epub"
pnpm assimilate --workspace "$WORKSPACE" ingest-repo "$TMPDIR/repo"
pnpm assimilate --workspace "$WORKSPACE" process-inbox
pnpm assimilate --workspace "$WORKSPACE" compile-wiki
pnpm assimilate --workspace "$WORKSPACE" render-portal
pnpm assimilate --workspace "$WORKSPACE" search Hermes
pnpm assimilate --workspace "$WORKSPACE" ask "Hermes memory"
pnpm assimilate --workspace "$WORKSPACE" suggest-concepts
pnpm assimilate --workspace "$WORKSPACE" suggest-links
pnpm assimilate --workspace "$WORKSPACE" daily-log --date 2026-05-27 --priority "Smoke test ASSIMILATOR"
pnpm assimilate --workspace "$WORKSPACE" memory-export
pnpm assimilate --workspace "$WORKSPACE" hindsight-export
pnpm assimilate --workspace "$WORKSPACE" inventory-library "$TMPDIR/books"
pnpm assimilate --workspace "$WORKSPACE" health-check
```

Network-dependent commands can be tested separately:

```bash
pnpm assimilate --workspace "$WORKSPACE" ingest-url "https://example.com"
pnpm assimilate --workspace "$WORKSPACE" ingest-youtube "https://youtube.com/watch?v=..."
```

## Commands

```bash
pnpm assimilate init
pnpm assimilate status
pnpm assimilate convert --file ./document.pdf
pnpm assimilate convert --url "https://example.com/article"
pnpm assimilate ingest <source-path>
pnpm assimilate ingest-url "https://example.com/article"
pnpm assimilate ingest-youtube "https://youtube.com/watch?v=..."
pnpm assimilate ingest-file examples/sample-inputs/hermes-memory-wiki-note.md --tag hermes
pnpm assimilate ingest-folder ./notes
pnpm assimilate ingest-book ./selected-book.epub
pnpm assimilate ingest-image ./screenshot.png
pnpm assimilate ingest-repo ./local-repo
pnpm assimilate process-inbox
pnpm assimilate compile-wiki
pnpm assimilate render-portal
pnpm assimilate search Hermes
pnpm assimilate ask "What do we know about Hermes memory?"
pnpm assimilate suggest-concepts
pnpm assimilate suggest-links
pnpm assimilate daily-log --priority "Ship ASSIMILATOR MVP"
pnpm assimilate memory-export
pnpm assimilate hindsight-export
pnpm assimilate health-check
pnpm assimilate inventory-library ./Books
pnpm assimilate tui
```

Use `--workspace <path>` before the command to target a different knowledge workspace.

## Command Notes

- `ingest-file` preserves the original file under `raw/` and writes derived Markdown, metadata, wiki pages, and indexes.
- `convert` is the pure AnythingMD-style path: file or URL in, Markdown and HTML out under `knowledge-system/converted/`.
- `ingest-url` uses Markit URL conversion and preserves the converted source Markdown under `raw/web/`.
- `ingest-folder` and `process-inbox` ingest supported files without moving or deleting originals.
- `ingest-book` only ingests one selected book. Use `inventory-library` first for large libraries.
- `ask` is local-first: it returns source-linked evidence from the wiki and does not call an external LLM.
- `daily-log` creates or appends to an Obsidian-compatible daily log page.
- `inventory-library` writes inventory metadata only and does not ingest full book text.
- `render-portal` writes static HTML pages plus `portal/search-index/pages.json`.
- `health-check` reports errors, warnings, and curation-oriented info items.

## Web App

Start the local web converter:

```bash
pnpm web
```

Then open:

```bash
open http://localhost:4321
```

The web app supports drag-and-drop file conversion and URL conversion. It previews Markdown and HTML, offers download/copy actions, and saves conversion artifacts under `knowledge-system/converted/`.

Saved conversion layout is type-aware:

```txt
knowledge-system/converted/
  youtube/<video-title>/<video-title>.md
  youtube/<video-title>/<video-title>.html
  web/<page-title>/<page-title>.md
  markdown/<file-title>/<file-title>.md
```

## Pure Conversion CLI

Agent-friendly examples:

```bash
pnpm assimilate convert --file ./report.pdf
pnpm assimilate convert --file ./report.pdf --print markdown
pnpm assimilate convert --file ./report.pdf --print html
pnpm assimilate convert --url "https://example.com/article"
pnpm assimilate convert --file ./notes.md --output-dir ./out
```

Interactive terminal UI:

```bash
pnpm assimilate tui
```

## First Supported Source Types

- `.md`
- `.txt`
- `.html` / `.htm` through Showdown HTML-to-Markdown import
- richer local formats through the `markit-ai` dependency

Markit is kept behind an adapter boundary so ASSIMILATOR still owns the canonical pipeline.

## Markit Adapter

ASSIMILATOR uses the `markit-ai` package directly for richer local conversion.

For debugging or local experiments, `ASSIMILATOR_MARKIT_BIN` can point to an alternate Markit-compatible command.

If `markit-ai` fails for a rich file or URL, ASSIMILATOR can try Microsoft MarkItDown as a fallback. Install the project-local Python tools first:

```bash
pnpm setup:python-tools
```

Override its command with:

```bash
ASSIMILATOR_MARKITDOWN_BIN="/path/to/markitdown" pnpm assimilate convert --file ./report.pdf
```

Examples:

```bash
pnpm assimilate ingest-file ./some-book.epub
```

Or with an explicit binary:

```bash
ASSIMILATOR_MARKIT_BIN="markit" pnpm assimilate ingest-file ./report.pdf
```

The current adapter does not pass prompts or external LLM options to Markit. This keeps the default flow local-first.

## YouTube and Audio

YouTube URLs use this chain:

1. `yt-dlp` transcript/subtitle extraction.
2. `markit-ai` URL conversion.
3. Microsoft `markitdown` CLI fallback when available.

ASSIMILATOR uses the project dependency `yt-dlp-exec` by default, so no global `yt-dlp` install is required.

Set a custom `yt-dlp` binary only if needed:

```bash
ASSIMILATOR_YTDLP_BIN="/opt/homebrew/bin/yt-dlp" pnpm assimilate convert --url "https://youtube.com/watch?v=..."
```

This transcript path usually does not require an LLM API key when subtitles or auto subtitles are available.

Audio files are different. `markit-ai` media transcription/description is LLM-backed, so audio transcription needs provider configuration such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Microsoft MarkItDown can transcribe audio through its optional audio dependencies and Google Speech Recognition service, which is not the same as a local/offline no-key path.

## Showdown Adapter

Showdown is used bidirectionally:

- Markdown to HTML for generated portal pages.
- HTML to Markdown for local HTML ingestion.

Node-side HTML import uses `jsdom` only inside the Showdown adapter so the rest of the pipeline still receives canonical Markdown.
