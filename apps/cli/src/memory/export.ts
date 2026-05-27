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
    const content = metadata.summary_short || `${metadata.title} was ingested into ASSIMILATOR.`;
    cards.push(MemoryCardSchema.parse({
      id: memoryId(metadata.id, 0),
      type: "insight",
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
