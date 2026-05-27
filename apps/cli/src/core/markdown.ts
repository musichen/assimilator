import matter from "gray-matter";
import type { SourceMetadata } from "./schemas.js";
import type { ExtractedSignals } from "./extract.js";

export function buildMarkdownArtifact(metadata: SourceMetadata, normalizedMarkdown: string, signals: ExtractedSignals): string {
  const frontmatter = {
    id: metadata.id,
    title: metadata.title,
    type: metadata.source_type,
    source: metadata.local_raw_path,
    source_url: metadata.source_url ?? "",
    author: metadata.author ?? "",
    created: metadata.created_at,
    ingested: metadata.ingested_at,
    tags: metadata.tags,
    related: metadata.related_concepts,
    status: metadata.processing_status,
    confidence: metadata.confidence,
    privacy_level: metadata.privacy_level
  };

  const body = [
    `# ${metadata.title}`,
    "",
    "## Short Summary",
    "",
    signals.summaryShort,
    "",
    "## Detailed Summary",
    "",
    "This artifact was generated locally from preserved source material. Rich LLM enrichment can be added later when privacy mode allows it.",
    "",
    "## Key Ideas",
    "",
    renderList(signals.keyIdeas),
    "",
    "## Important Facts",
    "",
    "- Needs human or agent review.",
    "",
    "## Concepts",
    "",
    renderList(signals.concepts.map((concept) => `[[${concept}]]`)),
    "",
    "## Entities",
    "",
    "- Needs extraction.",
    "",
    "## Links",
    "",
    renderList(signals.links),
    "",
    "## Commands",
    "",
    renderList(signals.commands),
    "",
    "## Action Items",
    "",
    renderList(signals.actionItems),
    "",
    "## Open Questions",
    "",
    renderList(signals.openQuestions),
    "",
    "## Related Wiki Pages",
    "",
    "- [[All Sources]]",
    "",
    "## Notes for Hermes",
    "",
    "Use this page as source-linked context. Prefer updating the wiki page and memory cards after meaningful work sessions.",
    "",
    "## Source References",
    "",
    `- Raw source: \`${metadata.local_raw_path}\``,
    "",
    "## Normalized Source",
    "",
    normalizedMarkdown
  ].join("\n");

  return matter.stringify(body, frontmatter);
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None extracted yet.";
}
