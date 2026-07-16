import fs from "node:fs/promises";
import path from "node:path";
import { listFiles } from "../core/fs.js";
import { memoryId } from "../core/ids.js";
import { MemoryCardSchema, type MemoryCard, type SourceMetadata } from "../core/schemas.js";

export interface MemoryExportResult {
  cards: MemoryCard[];
  jsonlPath: string;
  hermesPath: string;
  hindsightPath: string;
}

export async function exportMemoryCards(workspace: string): Promise<MemoryExportResult> {
  const metadataFiles = await listFiles(path.join(workspace, "processed", "metadata"), new Set([".json"]));
  const cards: MemoryCard[] = [];
  for (const filePath of metadataFiles.sort()) {
    const metadata = JSON.parse(await fs.readFile(filePath, "utf8")) as SourceMetadata;
    const markdownPath = path.join(workspace, metadata.processed_markdown_path);
    const markdown = await fs.readFile(markdownPath, "utf8").catch(() => "");
    const content = buildMemoryContent(metadata, markdown);
    cards.push(MemoryCardSchema.parse({
      id: memoryId(metadata.id, 0),
      type: inferMemoryType(metadata),
      content,
      source_id: metadata.id,
      source_reference: `wiki/articles/${metadata.title}.md`,
      related_projects: metadata.related_projects,
      related_concepts: metadata.related_concepts,
      tags: metadata.tags,
      confidence: metadata.confidence,
      privacy_level: metadata.privacy_level,
      created_at: new Date().toISOString()
    }));
  }

  const jsonl = cards.map((card) => JSON.stringify(card)).join("\n") + (cards.length ? "\n" : "");
  const jsonlPath = path.join(workspace, "memory", "cards", "cards.jsonl");
  const hermesPath = path.join(workspace, "memory", "hermes", "cards.jsonl");
  const hindsightPath = path.join(workspace, "memory", "hindsight", "cards.jsonl");
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  await fs.mkdir(path.dirname(hermesPath), { recursive: true });
  await fs.mkdir(path.dirname(hindsightPath), { recursive: true });
  await fs.writeFile(jsonlPath, jsonl);
  await fs.writeFile(hermesPath, jsonl);
  await fs.writeFile(hindsightPath, jsonl);
  return { cards, jsonlPath, hermesPath, hindsightPath };
}

function buildMemoryContent(metadata: SourceMetadata, markdown: string): string {
  const sections = extractSections(markdown, ["Short Summary", "Key Ideas", "Important Facts", "Action Items", "Open Questions"]);
  const lines = [
    `${metadata.title} (${metadata.source_type})`,
    metadata.summary_short ? `Summary: ${metadata.summary_short}` : "",
    sections.get("Key Ideas") ? `Key ideas:\n${sections.get("Key Ideas")}` : "",
    sections.get("Important Facts") ? `Facts:\n${sections.get("Important Facts")}` : "",
    sections.get("Action Items") ? `Actions:\n${sections.get("Action Items")}` : "",
    sections.get("Open Questions") ? `Questions:\n${sections.get("Open Questions")}` : "",
    metadata.related_concepts?.length ? `Concepts: ${metadata.related_concepts.slice(0, 12).join(", ")}` : "",
    `Source: ${metadata.processed_markdown_path}`,
  ].filter(Boolean);
  return lines.join("\n\n").slice(0, 4000);
}

function extractSections(markdown: string, names: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const name of names) {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(name)}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, "im");
    const match = markdown.match(pattern);
    const body = match?.[1]?.trim();
    if (body && !body.includes("None extracted yet") && !body.includes("Needs extraction")) {
      result.set(name, body.split(/\r?\n/).slice(0, 10).join("\n"));
    }
  }
  return result;
}

function inferMemoryType(metadata: SourceMetadata): MemoryCard["type"] {
  if (metadata.tags?.some((tag) => /workflow|process|howto|how-to/i.test(tag))) return "workflow";
  if (metadata.related_concepts?.some((concept) => /risk|failure|error/i.test(concept))) return "risk";
  return metadata.source_type === "youtube" || metadata.source_type === "url" ? "insight" : "fact";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
