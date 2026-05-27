# ASSIMILATOR — PLAN.md

> Universal local-first knowledge ingestion, conversion, wiki compilation, HTML portal rendering, and agent memory reinforcement system.

---

## 0. Executive Summary

ASSIMILATOR is a local-first knowledge compiler for AI-native work.

It absorbs arbitrary sources — URLs, articles, YouTube transcripts, PDFs, EPUB/MOBI books, DOCX/TXT/MD files, HTML pages, images, screenshots, audio, repos, datasets, chats, daily logs, and research reports — and turns them into structured, linked, searchable, agent-operable knowledge.

The core idea:

```txt
raw source
→ preserved archive
→ normalized Markdown
→ enriched Markdown
→ compiled wiki
→ rendered HTML portal
→ search/Q&A layer
→ Hermes/Hindsight memory cards
→ improved future work
```

ASSIMILATOR is inspired by Karpathy’s LLM knowledge-base pattern:

- collect raw sources into `raw/`
- use LLMs/agents to incrementally compile a Markdown wiki
- maintain summaries, backlinks, concept pages, and indexes
- browse the result in Obsidian
- ask complex questions against the wiki
- file useful outputs back into the knowledge base
- run health checks to improve data integrity

ASSIMILATOR productizes this into a reusable toolchain for Hermes, Hindsight, Obsidian, WebBoxes projectOS, and an HTML-based knowledge portal.

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

---

## 1. Product Goals

### 1.1 Primary Goal

Build a universal input-processing and knowledge-compilation system that lets the user quickly ingest anything they encounter and convert it into structured Markdown, an interlinked wiki, a rendered HTML portal, and curated agent memory.

### 1.2 Killer Primitives

#### Primitive 1: Universal Capture

The user can throw almost anything at ASSIMILATOR:

```txt
URL
YouTube video
transcript
PDF
EPUB/MOBI book
DOCX/TXT/MD
HTML page
image/screenshot
repo
folder
dataset
chat log
manual note
```

ASSIMILATOR detects source type, preserves raw source, extracts metadata, converts to Markdown, and logs provenance.

#### Primitive 2: Markdown Knowledge Compiler

ASSIMILATOR converts normalized Markdown into higher-level knowledge:

```txt
summaries
concepts
entities
links
commands
action items
open questions
decisions
project references
backlinks
memory cards
```

It creates and updates an Obsidian-compatible wiki.

#### Primitive 3: Bidirectional MD/HTML Knowledge Portal

Markdown is canonical. HTML is presentation and import/export.

```txt
Markdown → HTML portal via Showdown adapter
HTML/source pages → Markdown via Markit/Turndown/Pandoc adapter layer
```

The portal becomes a web-based knowledge UI with dashboards, search, backlinks, graph navigation, source browser, memory review, and project pages.

#### Primitive 4: Agent Memory Reinforcement

ASSIMILATOR creates curated, atomic memory cards for Hermes/Hindsight.

The memory layer should not ingest raw chaos. It should ingest high-quality, source-linked insights.

---

## 2. Non-Goals

Do not initially build:

- full enterprise CMS
- full VS Code/Obsidian replacement
- full RAG platform
- full vector database system
- full fine-tuning pipeline
- full public SaaS multi-tenant product
- full web clipping browser extension
- processing of all 5662 books at once
- perfect conversion for every file format
- portal-first product before CLI works

The MVP should focus on:

- CLI-first ingestion
- raw preservation
- Markdown conversion
- metadata and frontmatter
- wiki compilation
- indexes/backlinks
- Showdown HTML rendering
- simple search
- memory card export
- health checks

---

## 3. High-Level Architecture

```txt
┌────────────────────────────────────────────────────────────────┐
│                         ASSIMILATOR                            │
│                                                                │
│  ┌────────────────────┐       ┌──────────────────────────────┐ │
│  │ Capture Interfaces │       │   Core Knowledge Compiler    │ │
│  │                    │       │                              │ │
│  │ - CLI              │──────►│ - source registry            │ │
│  │ - inbox/drop       │       │ - metadata manager           │ │
│  │ - URL list         │       │ - hash/dedupe                │ │
│  │ - Hermes command   │       │ - conversion orchestrator    │ │
│  │ - browser later    │       │ - enrichment pipeline        │ │
│  └────────────────────┘       │ - wiki compiler              │ │
│                               │ - portal renderer            │ │
│                               │ - memory exporter            │ │
│                               │ - search/index builder       │ │
│                               │ - health checker             │ │
│                               └──────────────┬───────────────┘ │
│                                              │                 │
│    ┌──────────────┬──────────────┬───────────┼─────────────┐   │
│    ▼              ▼              ▼           ▼             ▼   │
│  raw/         processed/       wiki/       portal/       memory/│
│ evidence      markdown/html    canonical   rendered      cards  │
│                                                HTML             │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Core Design Principles

### 4.1 Markdown is source of truth

Bad model:

```txt
HTML portal owns knowledge.
SQLite owns knowledge.
Hindsight owns knowledge.
LLM chat owns knowledge.
```

Correct model:

```txt
Raw archive owns evidence.
Markdown wiki owns compiled knowledge.
HTML portal/search/memory are derived outputs.
```

### 4.2 Raw files are sacred

Original sources are preserved. Derived artifacts can be regenerated.

### 4.3 Agents maintain the wiki

The LLM/agent should maintain concept pages, summaries, indexes, backlinks, and daily logs. The human should mostly capture, review, and steer.

### 4.4 Start with simple search before RAG

Use Markdown indexes, summaries, backlinks, and ripgrep/SQLite FTS before reaching for vector databases.

### 4.5 Privacy is a first-class architecture concern

External LLM usage is controlled by privacy modes.

---

## 5. Repository Structure

Recommended monorepo:

```txt
assimilator/
  README.md
  PLAN.md
  CLAUDE.md
  AGENTS.md
  LICENSE
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  assimilator.config.example.yaml

  apps/
    cli/
      package.json
      src/
        index.ts
        commands/
          init.ts
          status.ts
          ingest.ts
          process-inbox.ts
          compile-wiki.ts
          render-portal.ts
          search.ts
          ask.ts
          health-check.ts
          memory-export.ts
          inventory-library.ts
        core/
          workspace.ts
          config.ts
          logger.ts
          paths.ts
          ids.ts
          hashing.ts
        converters/
          adapter.ts
          markit.ts
          showdown.ts
          html-to-md.ts
          passthrough.ts
        processors/
          metadata.ts
          markdown-artifact.ts
          enrich.ts
          concepts.ts
          entities.ts
        wiki/
          compiler.ts
          wikilinks.ts
          indexes.ts
          daily-log.ts
          pages.ts
        portal/
          render.ts
          routes.ts
          search-index.ts
        memory/
          cards.ts
          hindsight.ts
          hermes.ts
        search/
          ripgrep.ts
          sqlite-fts.ts
        health/
          checker.ts
          rules.ts

  apps/
    portal/
      package.json
      src/
        app/
        components/
        lib/
        styles/

  packages/
    schemas/
      src/
        source.ts
        artifact.ts
        memory-card.ts
        config.ts
        health.ts
    core/
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
    cli-reference.md

  examples/
    sample-inputs/
    sample-vault/
    sample-outputs/
```

---

## 6. Knowledge Workspace Specification

A workspace is where ASSIMILATOR stores user knowledge.

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
    markdown/
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

### 6.1 Directory semantics

`inbox/` is temporary capture.

`raw/` is immutable-ish evidence.

`processed/` is normalized derived material.

`wiki/` is canonical compiled knowledge.

`portal/` is generated web presentation.

`memory/` contains curated memory artifacts.

`logs/` records provenance, errors, and health checks.

---

## 7. Source and Artifact Schemas

### 7.1 Source type model

```ts
export type SourceType =
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
  | "chat"
  | "manual-note";
```

### 7.2 Source metadata

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

### 7.3 Markdown artifact

Every processed Markdown artifact must have frontmatter:

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

And body sections:

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

### 7.4 Memory card

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

Memory card types:

```txt
fact
insight
decision
project-context
technical-insight
open-loop
workflow
command
risk
preference
```

---

## 8. Conversion Pipeline

### 8.1 General flow

```txt
input source
→ detect type
→ compute id/hash
→ preserve raw source
→ write metadata
→ convert to Markdown
→ extract/enrich
→ write processed artifact
→ update wiki
→ update indexes
→ render portal if requested
→ create memory candidates
→ update logs
```

### 8.2 Markit role

Markit is a major adapter for arbitrary input → Markdown.

Use cases:

```txt
PDF → Markdown
DOCX → Markdown
PPTX → Markdown
XLSX → Markdown
HTML → Markdown
EPUB → Markdown
Jupyter → Markdown
RSS → Markdown
image → OCR/description/Markdown
audio → transcript/Markdown
URL → Markdown
```

### 8.3 Showdown role

Showdown is a major adapter for Markdown → HTML portal rendering.

Use cases:

```txt
wiki page Markdown → HTML page
source artifact Markdown → HTML preview
daily log Markdown → portal page
research report Markdown → HTML report
```

### 8.4 Bidirectional MD/HTML

ASSIMILATOR supports two modes:

```txt
Markdown-first mode:
Markdown → HTML

HTML-import mode:
HTML → Markdown → wiki → HTML
```

Markdown remains canonical.

---

## 9. CLI Specification

Target commands:

```bash
assimilate init [workspace]
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

### 9.1 `assimilate init`

Creates workspace structure and config.

Acceptance:

```txt
- creates all required folders
- writes assimilator.config.yaml
- writes starter wiki/index.md
- writes README inside workspace
- does not overwrite existing workspace without confirmation/flag
```

### 9.2 `assimilate ingest-file <path>`

MVP supports TXT and MD first.

Acceptance:

```txt
- copies or references raw file
- computes hash
- writes metadata
- writes processed Markdown artifact
- updates logs
- creates/updates wiki index
```

### 9.3 `assimilate compile-wiki`

Builds/updates higher-level pages.

Acceptance:

```txt
- updates index files
- creates concept pages from extracted concepts
- maintains backlinks
- updates daily log if configured
```

### 9.4 `assimilate render-portal`

Renders wiki Markdown to HTML.

Acceptance:

```txt
- uses Showdown adapter
- outputs HTML pages
- resolves basic wikilinks
- writes search metadata
- leaves Markdown unchanged
```

### 9.5 `assimilate health-check`

Runs wiki/data integrity checks.

Acceptance:

```txt
- outputs Markdown report
- outputs JSON report
- detects broken links, missing metadata, orphan pages
```

---

## 10. Wiki Compiler Specification

### 10.1 Wiki page types

```txt
concept
topic
project
person
company
tool
book
video
article
paper
repo
decision
question
command
daily-log
research-report
map
index
```

### 10.2 Obsidian compatibility

Use:

```txt
- Markdown files
- YAML frontmatter
- [[wikilinks]]
- #tags
- relative links
- attachments folder later
- stable filenames/slugs
```

### 10.3 Required indexes

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

### 10.4 Concept page template

```md
# {{Concept Name}}

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

### 10.5 Project page template

```md
# {{Project Name}}

## Goal

## Context

## Related Sources

## Decisions

## Tasks

## Research

## Commands

## Architecture Notes

## Risks

## Next Actions

## Backlinks
```

### 10.6 Daily log template

```md
# Daily Log - YYYY-MM-DD

## Main Priority

## Imports

## Work Done

## Decisions

## Tasks Created

## Tasks Completed

## New Concepts

## Memory Updates

## Follow-ups
```

---

## 11. HTML Portal Specification

### 11.1 Portal principle

The portal is a generated web view over the Markdown wiki.

It must not replace Markdown as canonical knowledge.

### 11.2 Portal sections

```txt
Dashboard
Sources
Wiki
Concepts
Projects
Daily Logs
Decisions
Commands
Questions
Memory Review
Search
Graph/Maps
```

### 11.3 Rendering pipeline

```txt
read wiki files
→ parse frontmatter
→ resolve wikilinks
→ render body with Showdown
→ wrap in layout
→ inject backlinks/navigation
→ write static HTML
→ build search index
```

### 11.4 MVP portal

Static HTML is acceptable for MVP.

Later portal can become:

```txt
Next.js app
React components
Tailwind UI
graph view
memory review workflow
interactive search
```

---

## 12. Search and Q&A

### 12.1 MVP search

Start simple:

```txt
ripgrep or SQLite FTS over wiki/ and processed/markdown/
```

Search should cover:

```txt
source metadata
processed Markdown
wiki pages
memory cards
commands
open questions
```

### 12.2 Q&A mode

`assimilate ask <query>` should eventually:

```txt
1. search indexes
2. read relevant pages
3. follow backlinks
4. produce an answer
5. optionally save answer as research report
6. optionally generate memory cards
```

Do not implement complex RAG before search/indexes work.

---

## 13. Memory Export Specification

### 13.1 Memory card generation

Each processed source may produce memory candidates.

Memory cards should be:

```txt
atomic
source-linked
confidence-scored
privacy-labeled
reviewable
exportable
```

### 13.2 Hindsight export

Output format should be simple JSONL and/or Markdown bundle:

```txt
memory/hindsight/memory-cards.jsonl
memory/hindsight/import-batch-YYYY-MM-DD.jsonl
```

### 13.3 Hermes export

Output:

```txt
memory/hermes/memory-summary.md
memory/hermes/project-context.md
memory/hermes/open-loops.md
```

Do not blindly export everything. Prefer curated cards.

---

## 14. Privacy Model

### 14.1 Modes

```yaml
privacy:
  default_mode: local_first
  modes:
    local_first:
      external_llm: false
      description: "Do not send full private documents to external LLMs."
    external_llm_allowed:
      external_llm: true
      description: "External LLM processing allowed."
    metadata_only:
      external_llm: false
      description: "Only scan metadata, filenames, hashes, and structure."
    ask_before_external:
      external_llm: ask
      description: "Ask before sending large/private content externally."
    project_public:
      external_llm: true
      description: "Safe for public docs, repos, public articles."
```

### 14.2 External processing log

When external processing is allowed, log:

```txt
source id
provider/model
content category
approximate size
privacy mode
purpose
timestamp
```

Do not log secrets or full private content.

---

## 15. Book Library Workflow

The user has a large digital library of approximately 5662 books.

### 15.1 Do not process all books first

First command:

```bash
assimilate inventory-library <path>
```

### 15.2 Inventory stages

```txt
scan paths
identify formats
extract metadata where possible
compute hashes
detect duplicates
guess language
guess topics from metadata/filename
write inventory
suggest priority clusters
```

### 15.3 Inventory output

```txt
processed/metadata/book-inventory.jsonl
wiki/indexes/Book Library.md
```

### 15.4 Selected processing

```bash
assimilate ingest-book ~/Library/Books/example.epub
```

Processing creates:

```txt
raw/books/...
processed/markdown/books/...
wiki/books/Book Title.md
wiki/concepts/...
memory/cards/...
```

---

## 16. Health Check System

### 16.1 Checks

```txt
orphan pages
broken wikilinks
duplicate concepts
missing summaries
missing metadata
stale pages
unlinked sources
sources without wiki representation
wiki pages without source support
too-long pages needing split
important repeated concepts without pages
open questions possibly answerable
conflicting claims
memory cards without sources
bad frontmatter
missing required sections
```

### 16.2 Outputs

```txt
logs/health-checks/YYYY-MM-DD.md
logs/health-checks/YYYY-MM-DD.json
wiki/indexes/Needs Review.md
```

### 16.3 Fix mode later

Later add:

```bash
assimilate health-check --fix-safe
```

Only safe fixes:

```txt
regenerate indexes
add missing backlinks
normalize tags
create placeholder pages
```

Never delete content automatically.

---

## 17. Dependency Strategy

### 17.1 Required early JS dependencies

Likely:

```txt
typescript
tsx
commander or cac
zod
yaml
gray-matter
showdown
fast-glob
fs-extra or native fs/promises
```

### 17.2 Converter dependencies

Use adapters, not hard dependencies everywhere:

```txt
markit
showdown
turndown optional
pandoc optional external
calibre/ebook-convert optional external
pdftotext optional external
pymupdf optional Python
tesseract optional external
yt-dlp optional external
ripgrep optional external
sqlite optional package
```

### 17.3 Dependency check command

```bash
assimilate status
```

Should report:

```txt
node version
pnpm availability
Markit availability
Showdown availability
Pandoc availability
Tesseract availability
yt-dlp availability
Calibre availability
ripgrep availability
SQLite availability
```

---

## 18. Implementation Phases

## Phase 0 — Specification and Repo Bootstrap

Deliverables:

```txt
README.md
PLAN.md
CLAUDE.md
AGENTS.md
package.json
pnpm-workspace.yaml
tsconfig.base.json
assimilator.config.example.yaml
docs/architecture.md
```

Acceptance:

```txt
- repo has clear mission and structure
- agents know project rules
- no implementation falsely claimed
```

## Phase 1 — CLI Skeleton and Workspace Init

Deliverables:

```txt
apps/cli/src/index.ts
assimilate init
assimilate status
workspace folder creation
config schema
logging helpers
```

Acceptance:

```txt
- `assimilate init ./knowledge-system` creates workspace
- `assimilate status` reports config and dependency state
- no destructive overwrites
```

## Phase 2 — Basic File Ingestion

Scope:

```txt
TXT
MD
pasted text file
```

Deliverables:

```txt
ingest-file command
source id/hash
raw preservation
metadata JSON/YAML
processed Markdown artifact
ingestion log
```

Acceptance:

```txt
- file is copied/referenced under raw/
- metadata is written
- processed Markdown is written
- rerun detects duplicate by hash
```

## Phase 3 — Markdown Artifact Enrichment

Deliverables:

```txt
frontmatter generator
summary placeholder or LLM/local hook
concept extraction placeholder
entity extraction placeholder
commands/action-items/open-questions sections
memory candidate generation
```

Acceptance:

```txt
- every artifact has required sections
- concepts are extracted or heuristically detected
- memory card candidates are generated
```

## Phase 4 — Wiki Compiler

Deliverables:

```txt
concept page creation
project page creation placeholder
source index
daily log update
wikilink generation
index files
```

Acceptance:

```txt
- `assimilate compile-wiki` creates/updates wiki pages
- Obsidian can open the wiki folder
- indexes link to source artifacts and concept pages
```

## Phase 5 — Showdown HTML Portal MVP

Deliverables:

```txt
render-portal command
Showdown adapter
static HTML layout
wikilink resolution
backlinks
basic search index JSON
```

Acceptance:

```txt
- `assimilate render-portal` produces browsable HTML
- concept/source/daily log pages render correctly
- Markdown remains canonical
```

## Phase 6 — Search

Deliverables:

```txt
search command
ripgrep or SQLite FTS backend
result ranking basics
source/wiki/memory coverage
```

Acceptance:

```txt
- `assimilate search "query"` returns useful matches
- results include file path, title, snippet, type
```

## Phase 7 — Health Check

Deliverables:

```txt
health-check command
broken wikilinks
missing metadata
orphan pages
duplicate concepts basic detection
Markdown + JSON reports
```

Acceptance:

```txt
- health report is generated
- Needs Review index is updated
```

## Phase 8 — Markit Integration

Deliverables:

```txt
Markit adapter
PDF/DOCX/HTML/EPUB smoke support where available
adapter fallback handling
warnings/errors
```

Acceptance:

```txt
- Markit converts supported formats to Markdown
- missing dependencies are reported clearly
- conversion errors do not corrupt workspace
```

## Phase 9 — URL, HTML, YouTube, Image, Repo Adapters

Deliverables:

```txt
URL ingestion
HTML import
YouTube transcript import where available/legal
image OCR/description adapter
repo README/docs ingestion
```

Acceptance:

```txt
- each adapter preserves raw/source metadata
- each produces Markdown artifacts
- each updates wiki/indexes
```

## Phase 10 — Book Library Inventory

Deliverables:

```txt
inventory-library command
book inventory JSONL
hashing/dedupe
format grouping
Book Library index
selected ingest-book flow
```

Acceptance:

```txt
- large library can be inventoried without full processing
- duplicates are detected
- selected books can be processed individually
```

## Phase 11 — Memory Export Integration

Deliverables:

```txt
memory-card review format
Hindsight JSONL export
Hermes summary export
privacy labels
source references
```

Acceptance:

```txt
- memory cards are source-linked
- exports are reviewable
- private/raw full text is not blindly exported
```

## Phase 12 — Portal UI Upgrade

Deliverables:

```txt
Next.js/React portal optional
Dashboard
Source browser
Concept browser
Project pages
Memory review
Search UI
Graph/index view
```

Acceptance:

```txt
- local portal is useful for browsing KB
- rendered pages link back to canonical Markdown/source
```

---

## 19. CLI UX Examples

```bash
assimilate init ~/Knowledge/assimilator
assimilate ingest-url "https://example.com/article"
assimilate ingest-youtube "https://youtube.com/watch?v=..."
assimilate ingest-file ~/Downloads/report.pdf
assimilate ingest-image ~/Desktop/screenshot.png
assimilate ingest-repo https://github.com/showdownjs/showdown
assimilate process-inbox
assimilate compile-wiki
assimilate render-portal
assimilate search "Hermes memory Hindsight"
assimilate ask "What do we know about Markdown-based agent memory?"
assimilate health-check
assimilate memory-export
assimilate inventory-library ~/Books
```

Potential aliases:

```bash
alias assim="assimilate"
alias assimilate-drop="assimilate process-inbox"
alias assimilate-wiki="assimilate compile-wiki"
alias assimilate-portal="assimilate render-portal"
```

---

## 20. Agent/Hermes Workflow

ASSIMILATOR should be operable by Hermes.

Examples:

```txt
Hermes, assimilate this article into the all0e project.
Hermes, import this transcript and extract all commands.
Hermes, process my Downloads/research folder.
Hermes, compile everything about Hindsight into a report.
Hermes, update the openWebBoxes project page with what we learned today.
Hermes, find contradictions in our memory-system notes.
Hermes, render the latest KB portal.
```

Hermes responsibilities:

```txt
watch inbox
process new sources
summarize imports
compile wiki
create backlinks
update daily logs
suggest memories
run health checks
answer questions from KB
generate reports/slides/maps
update project pages
detect stale knowledge
```

---

## 21. WebBoxes / openWebBoxes Positioning

ASSIMILATOR is a core future engine of openWebBoxes projectOS.

In the larger system:

```txt
ASSIMILATOR = knowledge ingestion engine
Hermes/OpenClaw = agent workforce
Hindsight = semantic memory
Obsidian = local knowledge IDE
HTML portal = team/company knowledge interface
projectOS = operating layer
```

It can support:

```txt
company knowledge
client research
AI workshops
technical documentation
product incubation
competitive analysis
book/library intelligence
engineering decisions
daily operations
agent memory
```

---

## 22. Acceptance Criteria for MVP

The MVP is successful when:

```txt
1. A user can initialize a workspace.
2. A user can ingest a TXT/MD file.
3. The raw source is preserved.
4. Metadata is written.
5. A normalized Markdown artifact is written.
6. A wiki index is updated.
7. At least one concept page can be created.
8. The wiki can be opened in Obsidian.
9. The wiki can be rendered to HTML via Showdown.
10. Search returns useful results.
11. A health-check report is generated.
12. Memory cards can be exported as JSONL.
13. The system respects privacy config.
14. The process is documented clearly.
```

---

## 23. Risks

### 23.1 Converter quality

Different sources convert poorly. Mitigation: adapter warnings, raw preservation, human review, per-format tests.

### 23.2 Overbuilding portal first

Portal can distract from ingestion. Mitigation: CLI-first roadmap.

### 23.3 Privacy leaks

Private books/docs can be accidentally sent externally. Mitigation: local-first default, privacy modes, external call logs.

### 23.4 Duplicate/fragmented concepts

Wiki can become messy. Mitigation: aliases, health checks, concept merge workflow.

### 23.5 Too much automation

Agent may hallucinate links or summaries. Mitigation: source references, confidence fields, health checks, review queues.

### 23.6 Huge book library

Processing thousands of books is expensive and risky. Mitigation: inventory-only first, selected processing, duplicate detection.

---

## 24. Future Explorations

Later features:

```txt
browser extension
Obsidian plugin
Telegram/Slack capture bot
Hermes scheduled inbox processing
local LLM summarization pipeline
embeddings/vector search optional
knowledge graph visualization
Marp slide generation
Mermaid concept maps
fine-tuning/synthetic data generation
team/company portal publishing
client-specific knowledge portals
ASSIMILATOR as projectOS module
```

---

## 25. Final Product Vision

ASSIMILATOR is not just a converter, wiki, RAG system, or portal.

It is a universal knowledge compiler for AI-native work.

Final one-line vision:

```txt
ASSIMILATOR turns everything you encounter into structured, linked, searchable, agent-operable knowledge.
```

Final WebBoxes framing:

```txt
ASSIMILATOR is the knowledge engine that lets an AI-native company absorb the world, compile it into understanding, and turn that understanding into action.
```
