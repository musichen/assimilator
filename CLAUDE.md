# CLAUDE.md — ASSIMILATOR Project Instructions

The current project is **ASSIMILATOR**.

ASSIMILATOR is a local-first universal knowledge ingestion, conversion, compilation, and publishing system. It absorbs arbitrary sources, preserves raw originals, converts them into structured Markdown, compiles an interlinked wiki, renders a web-based HTML knowledge portal, and prepares high-quality memory cards for Hermes Agent and Hindsight.

Core slogan:

```txt
Markit absorbs.
Markdown remembers.
Showdown renders.
Hermes operates.
Hindsight reinforces.
Obsidian browses.
ASSIMILATOR connects it all.
```

Before implementing substantial features, read:

- `README.md` for the short product description.
- `PLAN.md` for architecture, phases, and acceptance criteria.
- `AGENTS.md` for Codex/OpenCode/generic agent instructions.
- `docs/architecture.md`, `docs/conversion-pipeline.md`, `docs/privacy-model.md`, and `docs/wiki-schema.md` once they exist.

The repository is at specification/bootstrap stage until source code is actually added. Do not describe planned modules or features as implemented.

Favored first stack:

```txt
Node.js / TypeScript CLI
+ Markit adapter for anything → Markdown
+ Showdown adapter for Markdown → HTML rendering
+ optional Turndown/Pandoc adapters for HTML → Markdown and advanced conversion
+ SQLite FTS or JSONL indexes for local search
+ Markdown/YAML frontmatter as canonical knowledge source
+ Obsidian-compatible wiki
+ static/local HTML portal
+ Hindsight/Hermes memory-card export
```

Possible later stack:

```txt
Next.js / React / TypeScript portal
+ Tailwind CSS
+ SQLite / DuckDB / LanceDB optional indexes
+ worker queue for batch processing
+ local OCR/transcription/document conversion tools
+ Hermes/OpenClaw/projectOS integration
```

---

## 1. Core Product Principles

### 1.1 Markdown is canonical

Do **not** make HTML, a database, or a vendor memory provider the only source of truth.

Correct model:

```txt
raw source archive = evidence
Markdown wiki = canonical knowledge layer
HTML portal = presentation layer
SQLite/indexes = derived acceleration layer
Hindsight/Hermes memory = curated reinforcement layer
```

The project must remain usable even if the portal, search index, or database is deleted and regenerated.

### 1.2 Preserve raw sources

ASSIMILATOR never destroys original source material.

Every ingestion should preserve or reference the original input under `raw/` and then write derived artifacts under `processed/`, `wiki/`, `portal/`, and `memory/`.

### 1.3 Agent-maintained wiki

The user should rarely edit the wiki manually. Claude, Codex, Hermes, or other agents should maintain:

```txt
- source summaries
- concept pages
- project pages
- daily logs
- indexes
- backlinks
- decision logs
- open questions
- memory cards
- health-check reports
```

### 1.4 Local-first and privacy-first

Private documents, books, chats, and company files must not be sent to external LLM providers unless the configured privacy mode explicitly permits it.

Default behavior:

```txt
privacy_mode: local_first
```

Large private libraries must be inventoried first, not blindly processed.

### 1.5 Small tools before fancy RAG

At small-to-medium scale, prefer:

```txt
Markdown summaries
indexes
backlinks
ripgrep/SQLite FTS
agent-readable maps
```

Do not introduce complex RAG, vector databases, or fine-tuning before the basic ingestion, wiki, search, and health-check loop works.

---

## 2. Product Definition

ASSIMILATOR is a universal knowledge compiler.

It supports:

```txt
Capture → Preserve → Convert → Enrich → Compile → Render → Search → Ask → Remember → Improve
```

Input classes:

```txt
- URLs and web articles
- HTML pages
- YouTube URLs and transcripts
- PDFs
- EPUB/MOBI books
- DOCX/TXT/MD documents
- PPTX/XLSX/CSV files
- images and screenshots
- audio/transcripts
- GitHub repos and local repos
- datasets
- Hermes conversations
- daily logs
- research reports
- pasted notes
```

Primary outputs:

```txt
- raw archive
- normalized Markdown
- enriched Markdown
- Obsidian-compatible compiled wiki
- static or dynamic HTML portal
- search index
- memory cards for Hermes/Hindsight
- health-check reports
- research reports/slides/maps
```

---

## 3. Non-Negotiable Development Rules

- NEVER delete or overwrite original source files.
- NEVER batch-process the full private book library unless explicitly requested.
- NEVER send private full-text documents to external APIs unless privacy mode allows it.
- NEVER store API keys, passwords, tokens, or secrets in repository files.
- NEVER run destructive git operations unless explicitly requested.
- Forbidden unless explicitly requested:
  - `git reset --hard`
  - `git clean -fd`
  - `rm -rf`
  - force-push
  - bulk deletion of raw/ or library files
- Always run `git status` before staging, committing, merging, deleting generated files, or running risky commands.
- Never use `git add .` or `git add -A`.
- Stage only files intentionally modified, using explicit paths.
- Do not start, stop, kill, or restart user-running servers/processes unless explicitly asked.
- Do not assume ports, daemons, or agent sessions are yours.
- No quick hacks. Fix root causes.
- Validate unknown data at system boundaries.
- Be explicit about generated vs canonical files.
- Keep all ingestion logs and processing errors inspectable.

---

## 4. Package Manager and Runtime Rules

Use **PNPM only** for JavaScript/TypeScript packages.

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

If the repo uses a workspace, respect `pnpm-workspace.yaml`.

For Python helper tools, use a dedicated virtual environment and document it:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Do not silently install global system packages. If external tools are missing, report them and provide install commands.

---

## 5. Expected Repository Structure

Prefer this structure unless the existing repository differs:

```txt
assimilator/
  README.md
  PLAN.md
  CLAUDE.md
  AGENTS.md
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
    memory-card-schema.md
    book-library-workflow.md

  examples/
    sample-vault/
    sample-inputs/
    sample-outputs/
```

If the actual repo differs, adapt to reality. Do not create unnecessary parallel architecture.

---

## 6. Knowledge Workspace Structure

ASSIMILATOR should manage a workspace folder. Default local shape:

```txt
knowledge-system/
  assimilator.config.yaml

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
    index.md
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

Important:

- `raw/` is evidence and must not be deleted automatically.
- `processed/` is derived and can be regenerated.
- `wiki/` is canonical compiled knowledge and should be git-friendly.
- `portal/` is presentation and can be regenerated from `wiki/`.
- `memory/` contains curated memory exports, not raw dumps.
- `logs/` tracks provenance and debugging.

---

## 7. Conversion Architecture

### 7.1 Markit adapter

Markit is the preferred first adapter for “anything → Markdown”.

Use it behind a clean interface:

```ts
interface ConverterAdapter {
  name: string;
  canConvert(input: SourceDescriptor): Promise<boolean>;
  convert(input: SourceDescriptor, options: ConvertOptions): Promise<ConversionResult>;
}
```

Do not couple business logic directly to Markit internals. The converter layer must allow additional adapters.

### 7.2 Showdown adapter

Showdown is the preferred Markdown → HTML rendering adapter.

Use it behind a clean interface:

```ts
interface MarkdownRenderer {
  name: string;
  render(markdown: string, options: RenderOptions): Promise<HtmlRenderResult>;
}
```

Do not treat Showdown as the only bidirectional converter. Showdown is primarily Markdown → HTML. For HTML → Markdown, use a dedicated adapter such as Turndown, Markit, Pandoc, or a custom normalizer.

### 7.3 Canonical conversion rule

All sources must flow through Markdown before becoming wiki pages or memory cards.

```txt
source → raw archive → normalized Markdown → enriched Markdown → wiki/portal/memory
```

---

## 8. CLI Commands

The CLI should eventually expose:

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

Short alias may be documented:

```bash
assim ingest <source>
assim compile
assim portal
assim search "query"
```

Every command must be safe by default and explain what it will modify.

---

## 9. Data Schemas

Use Zod or equivalent schema validation at boundaries.

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

### 9.2 Markdown artifact frontmatter

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

Required sections:

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

Do not create vague memory cards. Make them concise, atomic, source-linked, and useful.

---

## 10. Wiki Compilation Rules

The wiki is not just source summaries. It is a higher-level knowledge graph in Markdown.

Use Obsidian-style links:

```txt
[[Concept Name]]
[[Project Name]]
[[Daily Log - 2026-05-26]]
```

Create or update pages for:

```txt
concepts
topics
projects
people
companies
tools
books
videos
papers
repos
decisions
questions
commands
research reports
daily logs
```

Each concept page should include:

```md
# Concept Name

## Definition

## Why It Matters

## Related Sources

## Related Concepts

## Related Projects

## Key Claims

## Contradictions / Caveats

## Practical Uses

## Open Questions

## Timeline

## Backlinks
```

Indexes to maintain:

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

---

## 11. Portal Rendering Rules

The portal is derived from Markdown.

Rendering pipeline:

```txt
wiki/*.md
→ parse frontmatter
→ resolve wikilinks
→ render Markdown to HTML via Showdown adapter
→ add backlinks / navigation / search index
→ write portal output
```

Portal must support:

```txt
- dashboard
- source browser
- wiki browser
- concept pages
- project pages
- daily logs
- decision log
- command library
- memory review
- search
- graph/index pages
```

Do not make portal-only edits canonical unless there is a clear HTML → Markdown import path.

---

## 12. Privacy Model

Config should support:

```yaml
privacy:
  default_mode: local_first
  modes:
    local_first: "Do not send full private documents to external LLMs."
    external_llm_allowed: "External LLM processing allowed."
    metadata_only: "Only process filenames, metadata, hashes, and structure."
    ask_before_external: "Ask before sending large/private content externally."
    project_public: "Safe for public docs, repos, and public articles."
```

Any external LLM call must include a clear boundary:

```txt
what content is sent
why it is needed
which provider/model is used
what privacy mode allowed it
```

For local-first mode, prefer local tools for extraction, OCR, and summarization when available.

---

## 13. Book Library Rules

The user has a large mixed-format book library. Treat it carefully.

Never process all books by default.

Staged workflow:

```txt
1. scan library
2. build inventory
3. extract metadata only
4. hash files
5. detect duplicates
6. group by author/topic/language
7. suggest priorities
8. process selected books only
9. create book cards
10. compile reading maps
```

Inventory schema:

```yaml
path:
title:
author:
format:
size:
language:
hash:
duplicate_group:
topic_guesses:
processing_status:
privacy_level:
```

---

## 14. Health Checks

Implement `assimilate health-check`.

Checks:

```txt
- orphan wiki pages
- broken wikilinks
- duplicate concepts
- missing summaries
- missing metadata
- stale pages
- unlinked sources
- sources without wiki representation
- wiki pages without source support
- too-long pages needing split
- repeated concepts needing dedicated pages
- open questions that may now be answerable
- conflicting claims
- memory cards without source references
```

Output:

```txt
logs/health-checks/YYYY-MM-DD.md
logs/health-checks/YYYY-MM-DD.json
```

---

## 15. Agent Workflow

Before coding:

1. Read `PLAN.md`.
2. Read this `CLAUDE.md`.
3. Inspect the current repository structure.
4. Check package manager and runtime files.
5. Identify the smallest safe implementation slice.
6. Write a short implementation plan in the task artifact or response.

After coding:

1. Run relevant tests once.
2. Run typecheck/lint if available.
3. Do not use watch mode.
4. Summarize changed files.
5. Document missing dependencies or skipped tests.
6. Update relevant docs if behavior changed.

Required task artifacts when this project is used with ALLAGENT/Hermes:

```txt
.assimilator/tasks/<TASK-ID>/plan.md
.assimilator/tasks/<TASK-ID>/result.md
.assimilator/tasks/<TASK-ID>/risks.md
.assimilator/tasks/<TASK-ID>/diff-summary.md
```

If no `.assimilator/` task system exists yet, report in chat and create docs only when requested.

---

## 16. TypeScript Standards

- Use strict TypeScript.
- Avoid `any`.
- Avoid unsafe assertions.
- Validate unknown inputs with schemas.
- Prefer discriminated unions for source types and command results.
- Keep command handlers thin.
- Put domain logic in core packages.
- Avoid huge catch-all functions.

Bad:

```ts
const source = raw as SourceMetadata;
```

Better:

```ts
const source = SourceMetadataSchema.parse(raw);
```

Use one canonical internal format. Normalize once at boundaries.

---

## 17. Testing Rules

Use run-once tests only.

Forbidden watch/interactive modes:

```bash
pnpm test --watch
pnpm vitest --watch
pnpm playwright test --ui
```

Allowed examples:

```bash
pnpm -s test
pnpm vitest run
pnpm test:unit
pnpm test:integration
pnpm typecheck
```

Minimum tests to add early:

```txt
- source metadata parsing
- Markdown frontmatter parsing
- Markit adapter smoke test with text/markdown input
- Showdown renderer smoke test
- wiki link generation
- index generation
- memory card schema validation
- health-check broken link detection
```

---

## 18. Documentation Rules

Keep docs practical and agent-readable.

Important docs:

```txt
docs/architecture.md
docs/conversion-pipeline.md
docs/privacy-model.md
docs/wiki-schema.md
docs/memory-card-schema.md
docs/book-library-workflow.md
docs/portal-rendering.md
docs/hindsight-integration.md
```

Whenever behavior changes, update docs in the same task.

---

## 19. MVP Implementation Priority

Do not start with the full portal or 5662-book processing.

MVP order:

```txt
1. repo skeleton and config
2. CLI init/status
3. ingest pasted text or local TXT/MD
4. metadata + hash + raw preservation
5. normalized Markdown artifact
6. simple concept/entity extraction placeholder
7. wiki page creation
8. index update
9. Showdown HTML render
10. search with ripgrep or simple SQLite FTS
11. memory card export
12. health-check
```

Only after that add PDF/EPUB/DOCX/YouTube/image/repo ingestion.

---

## 20. Final Instruction

ASSIMILATOR is not a toy note app and not only a converter.

Build toward this product truth:

```txt
ASSIMILATOR turns everything the user encounters into structured, linked, searchable, agent-operable knowledge.
```
