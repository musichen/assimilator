# AGENTS.md — ASSIMILATOR Codex / Generic Agent Instructions

This file contains project-specific instructions for Codex, OpenCode, Hermes, and other coding agents working in the ASSIMILATOR repository.

ASSIMILATOR is a local-first universal knowledge ingestion and compilation system. It absorbs arbitrary sources, converts them into Markdown, compiles an interlinked Obsidian-compatible wiki, renders an HTML portal, and exports curated memory cards for Hermes Agent and Hindsight.

Core product model:

```txt
raw sources = preserved evidence
Markdown = canonical knowledge
HTML = rendered portal
indexes = derived search/navigation
memory cards = curated reinforcement
agents = operators/compilers
```

Favored stack:

```txt
Node.js / TypeScript CLI
+ Markit adapter for anything → Markdown
+ Showdown adapter for Markdown → HTML
+ optional Turndown/Pandoc/Calibre/PyMuPDF/Tesseract adapters
+ Markdown/YAML frontmatter
+ Obsidian-style wikilinks
+ SQLite FTS or JSONL search indexes
+ local HTML/Next.js portal later
+ Hindsight/Hermes memory-card export
```

---

## 1. Prime Directive

ASSIMILATOR owns the canonical knowledge pipeline.

Do not design around any single converter, LLM, database, portal, or memory provider as the source of truth.

Correct model:

```txt
Source → Raw Archive → Markdown → Wiki → Portal/Search/Memory
```

The system must remain portable, inspectable, git-friendly, and recoverable.

---

## 2. Product Mission

ASSIMILATOR should let the user quickly import anything they encounter:

```txt
URLs, articles, YouTube transcripts, PDFs, EPUB/MOBI books, DOCX, TXT, MD,
HTML, images, screenshots, audio, repos, datasets, chats, notes, reports.
```

Then it should produce:

```txt
- preserved raw source
- normalized Markdown
- enriched source summary
- extracted concepts/entities/links/commands/questions/tasks
- compiled wiki pages
- indexes and backlinks
- rendered HTML portal
- searchable local index
- memory cards for Hermes/Hindsight
- daily logs and project links
```

The user’s larger goal is a Karpathy-style LLM-maintained knowledge base operated by Hermes and viewable in Obsidian and a web portal.

---

## 3. Non-Negotiable Safety Rules

- NEVER delete raw source files.
- NEVER overwrite user files without creating a derived copy.
- NEVER batch-process the user’s full private book library unless explicitly requested.
- NEVER upload private full-text content to external APIs unless privacy mode allows it.
- NEVER store secrets in repo files.
- NEVER run destructive git operations unless explicitly requested.
- Forbidden unless explicitly requested:
  - `git reset --hard`
  - `git clean -fd`
  - `rm -rf`
  - force-push
  - bulk deletion of `raw/`, `wiki/`, or user library folders
- Always run `git status` before staging, committing, merging, or running risky git commands.
- Never use `git add .` or `git add -A`.
- Stage only explicit paths you intentionally modified.
- Do not start, stop, kill, or restart user-running servers/processes unless explicitly asked.
- Do not assume ports or local daemons are yours.
- No quick hacks. Fix root causes.
- Validate input at boundaries.
- Log ingestion/processing errors instead of hiding them.

---

## 4. Package Manager

Use PNPM only for JavaScript/TypeScript packages.

Do not use:

```bash
npm install
npm add
yarn
```

Use:

```bash
pnpm install
pnpm add <package>
pnpm remove <package>
pnpm run <script>
```

For Python tools, use a local virtual environment and document dependencies. Do not install global packages silently.

---

## 5. Preferred Repository Shape

Prefer this shape unless the existing repo differs:

```txt
assimilator/
  README.md
  PLAN.md
  AGENTS.md
  CLAUDE.md
  LICENSE
  package.json
  pnpm-workspace.yaml
  assimilator.config.example.yaml

  apps/
    cli/
      src/
        index.ts
        commands/
        core/
        converters/
        processors/
        wiki/
        portal/
        memory/
        search/
        health/
    portal/
      src/
        app/
        components/
        lib/
        styles/

  packages/
    core/
    schemas/
    converters/
    wiki-compiler/
    portal-renderer/
    memory-exporter/
    search/

  python/
    assimilator_tools/
    requirements.txt

  docs/
    architecture.md
    conversion-pipeline.md
    privacy-model.md
    wiki-schema.md
    portal-rendering.md
    memory-card-schema.md
    book-library-workflow.md

  examples/
    sample-inputs/
    sample-vault/
    sample-outputs/
```

If the repo has a different structure, adapt to the existing structure. Do not create duplicate architecture.

---

## 6. Knowledge Workspace Is a Product API

ASSIMILATOR should operate on a portable workspace directory.

Target shape:

```txt
knowledge-system/
  assimilator.config.yaml
  inbox/
  raw/
  processed/
  wiki/
  portal/
  memory/
  logs/
```

Detailed target:

```txt
inbox/
  drop/
  urls/
  youtube/
  books/
  articles/
  images/
  screenshots/
  repos/
  manual-notes/

raw/
  web/
  youtube/
  books/
  pdfs/
  epub/
  mobi/
  docx/
  txt/
  html/
  images/
  audio/
  repos/
  datasets/
  transcripts/
  chats/

processed/
  markdown/
  html/
  extracted-text/
  ocr/
  transcripts/
  summaries/
  metadata/
  chunks/

wiki/
  concepts/
  topics/
  projects/
  people/
  companies/
  tools/
  books/
  videos/
  articles/
  papers/
  repos/
  decisions/
  questions/
  commands/
  daily-logs/
  research-reports/
  maps/
  indexes/

portal/
  public/
  pages/
  assets/
  search-index/
  graph-index/

memory/
  cards/
  hindsight/
  hermes/
  exports/

logs/
  ingestion.jsonl
  processing.jsonl
  errors.jsonl
  health-checks/
```

Rules:

- `raw/` is never modified destructively.
- `processed/` can be regenerated.
- `wiki/` is canonical compiled knowledge.
- `portal/` is generated presentation.
- `memory/` is curated, not a raw dump.
- `logs/` are append-only where practical.

---

## 7. Converter Strategy

### 7.1 Markit

Use Markit as a major adapter for anything → Markdown.

Expected use cases:

```txt
PDF, DOCX, PPTX, XLSX, HTML, EPUB, Jupyter, RSS, images, audio, URLs, etc.
```

Keep Markit behind an adapter interface. Do not hardwire every domain object directly to Markit-specific APIs.

### 7.2 Showdown

Use Showdown as the major Markdown → HTML rendering adapter for the HTML portal.

Do not assume Showdown alone solves reliable HTML → Markdown. Use an HTML-import adapter layer and optionally Turndown, Markit, Pandoc, or custom normalization.

### 7.3 Adapter interface

Use conceptual interfaces like:

```ts
type SourceType =
  | "url"
  | "youtube"
  | "pdf"
  | "epub"
  | "mobi"
  | "docx"
  | "txt"
  | "markdown"
  | "html"
  | "image"
  | "audio"
  | "repo"
  | "folder"
  | "dataset"
  | "chat";

interface SourceDescriptor {
  id: string;
  type: SourceType;
  input: string;
  privacyLevel: "public" | "internal" | "private" | "sensitive";
}

interface ConversionResult {
  sourceId: string;
  markdownPath: string;
  metadataPath: string;
  assets: string[];
  warnings: string[];
}
```

Normalize once at boundaries. Use one canonical internal format.

---

## 8. CLI Requirements

Implement CLI-first.

Target commands:

```bash
assimilate init
assimilate status
assimilate ingest <source>
assimilate ingest-url <url>
assimilate ingest-youtube <youtube_url>
assimilate ingest-file <path>
assimilate ingest-folder <path>
assimilate ingest-book <path>
assimilate ingest-image <path>
assimilate ingest-repo <url_or_path>
assimilate process-inbox
assimilate compile-wiki
assimilate render-portal
assimilate search <query>
assimilate ask <query>
assimilate health-check
assimilate suggest-concepts
assimilate suggest-links
assimilate daily-log
assimilate memory-export
assimilate hindsight-export
assimilate inventory-library <path>
```

Each command should:

```txt
- validate inputs
- respect privacy mode
- preserve raw source
- write metadata
- produce logs
- fail safely
- be idempotent where practical
```

---

## 9. Canonical Schemas

Use schema validation for all JSON/YAML frontmatter.

### 9.1 Source metadata

```yaml
id:
source_type:
title:
author:
source_url:
local_raw_path:
processed_markdown_path:
processed_html_path:
created_at:
ingested_at:
updated_at:
tags:
language:
summary_short:
summary_long:
related_projects:
related_topics:
related_concepts:
related_people:
related_tools:
related_companies:
confidence:
freshness:
privacy_level:
license_or_rights_notes:
processing_status:
errors:
hash:
duplicate_of:
```

### 9.2 Markdown artifact

Required frontmatter:

```yaml
---
id:
title:
type:
source:
source_url:
author:
created:
ingested:
tags:
related:
status:
confidence:
privacy_level:
---
```

Required body sections:

```md
# Title

## Short Summary
## Detailed Summary
## Key Ideas
## Important Facts
## Concepts
## Entities
## Links
## Commands
## Action Items
## Open Questions
## Related Wiki Pages
## Notes for Hermes
## Source References
```

### 9.3 Memory card

```json
{
  "id": "mem_...",
  "type": "insight",
  "content": "Atomic memory statement.",
  "source_id": "src_...",
  "source_reference": "wiki/path.md",
  "related_projects": [],
  "related_concepts": [],
  "tags": [],
  "confidence": "high",
  "privacy_level": "private",
  "created_at": "2026-05-26T00:00:00Z"
}
```

Memory cards must be atomic, source-linked, reviewable, and exportable.

---

## 10. Wiki Rules

Use Obsidian-compatible Markdown.

Use:

```txt
YAML frontmatter
[[wikilinks]]
#tags
relative asset links
stable filenames
```

Maintain pages for:

```txt
concepts, topics, projects, people, companies, tools, books, videos,
articles, papers, repos, decisions, questions, commands, daily logs,
research reports, maps, indexes.
```

Required indexes:

```txt
wiki/indexes/Home.md
wiki/indexes/All Sources.md
wiki/indexes/All Concepts.md
wiki/indexes/All Books.md
wiki/indexes/All Videos.md
wiki/indexes/All Tools.md
wiki/indexes/All Projects.md
wiki/indexes/All Open Questions.md
wiki/indexes/All Commands.md
wiki/indexes/All Decisions.md
wiki/indexes/Recently Updated.md
wiki/indexes/Needs Review.md
```

Do not create duplicate concept pages with slightly different names unless aliases are handled deliberately.

---

## 11. HTML Portal Rules

Portal is derived from Markdown.

Pipeline:

```txt
wiki Markdown
→ parse frontmatter
→ resolve wikilinks
→ render with Showdown adapter
→ add navigation/backlinks/search metadata
→ write portal files
```

Portal features:

```txt
- dashboard
- source browser
- concept browser
- project browser
- daily logs
- decision log
- command library
- memory review
- search
- graph/index pages
```

Never make generated HTML the only copy of knowledge.

---

## 12. Privacy Rules

Default privacy mode is `local_first`.

Supported modes:

```txt
local_first
external_llm_allowed
metadata_only
ask_before_external
project_public
```

Before any external LLM processing of private material, ensure config allows it. Log what was sent at a high level without leaking secrets.

Do not include private full text in error logs.

---

## 13. Book Library Rules

The user has approximately 5662 books in mixed formats.

Do not ingest them all.

First implement:

```bash
assimilate inventory-library <path>
```

Inventory only:

```txt
path, title, author, format, size, hash, possible language, duplicate group,
topic guesses, processing status, privacy level
```

Then support selected processing:

```bash
assimilate ingest-book <path>
```

---

## 14. Health Check Rules

`assimilate health-check` should detect:

```txt
orphan pages
broken links
duplicate concepts
missing summaries
missing metadata
stale pages
unlinked sources
sources without wiki representation
wiki pages without source support
too-long pages needing split
repeated concepts needing dedicated pages
open questions possibly answerable
conflicting claims
memory cards without source references
```

Write both Markdown and JSON reports.

---

## 15. Git and Change Rules

Always run:

```bash
git status
```

before staging, committing, merging, or deleting generated artifacts.

Never use:

```bash
git add .
git add -A
```

Use explicit paths:

```bash
git add PLAN.md AGENTS.md CLAUDE.md packages/core/src/foo.ts
```

Do not commit secrets, private raw documents, or large user libraries.

Recommended `.gitignore`:

```gitignore
node_modules/
dist/
.next/
.DS_Store
.env
.env.*
!.env.example

# local private knowledge workspace by default
knowledge-system/raw/
knowledge-system/inbox/
knowledge-system/logs/
knowledge-system/processed/
knowledge-system/portal/

# keep canonical sample wiki only if intentional
```

Project must clearly distinguish demo/sample data from private user knowledge.

---

## 16. TypeScript Standards

- Use strict TypeScript.
- Avoid `any`.
- Avoid unsafe assertions.
- Use Zod or equivalent validation at boundaries.
- Prefer discriminated unions for source types, command results, privacy modes, and processing statuses.
- Keep CLI command handlers thin.
- Put core logic in testable packages.

Bad:

```ts
const metadata = raw as SourceMetadata;
```

Better:

```ts
const metadata = SourceMetadataSchema.parse(raw);
```

---

## 17. Testing

Use run-once tests only.

Forbidden:

```bash
pnpm test --watch
pnpm vitest --watch
pnpm playwright test --ui
```

Allowed:

```bash
pnpm -s test
pnpm vitest run
pnpm typecheck
pnpm lint
```

Add early tests for:

```txt
metadata schema
Markdown frontmatter parsing
raw file preservation
hash/deduplication
Showdown rendering
wiki link resolution
index generation
memory card validation
health-check broken link detection
```

---

## 18. Agent Artifacts

When operating in an agent-orchestrated environment, write structured task artifacts:

```txt
.assimilator/tasks/<TASK-ID>/plan.md
.assimilator/tasks/<TASK-ID>/result.md
.assimilator/tasks/<TASK-ID>/risks.md
.assimilator/tasks/<TASK-ID>/diff-summary.md
```

Do not rely on private chat as project memory. Important decisions belong in docs or decision logs.

---

## 19. MVP Priority

Implement in this order:

```txt
1. repository skeleton
2. config schema
3. CLI init/status
4. ingest local TXT/MD and pasted text
5. preserve raw source and metadata
6. normalized Markdown artifact
7. simple enrichment sections
8. wiki page creation
9. index update
10. Markdown → HTML render via Showdown
11. search
12. memory-card export
13. health-check
14. Markit integration for more file types
15. URL/HTML ingestion
16. PDF/EPUB/DOCX/image/YouTube/repo adapters
17. portal UI
```

Do not build the full web portal before the ingestion and Markdown pipeline work.

---

## 20. Final Product Truth

ASSIMILATOR is not just a converter, not just a wiki, not just RAG, and not just Obsidian automation.

It is the universal input and knowledge compilation layer for an AI-native company.

Build accordingly.
