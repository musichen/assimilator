import fs from "node:fs/promises";
import path from "node:path";
import type { SourceMetadata } from "../core/schemas.js";
import { listFiles } from "../core/fs.js";

export interface ConceptSuggestion {
  concept: string;
  count: number;
  sources: string[];
}

export interface LinkSuggestion {
  source: string;
  concept: string;
  target: string;
}

export async function suggestConcepts(workspace: string): Promise<ConceptSuggestion[]> {
  const files = await listFiles(path.join(workspace, "processed", "metadata"), new Set([".json"]));
  const concepts = new Map<string, { count: number; sources: Set<string> }>();
  for (const filePath of files) {
    const metadata = JSON.parse(await fs.readFile(filePath, "utf8")) as SourceMetadata;
    for (const concept of metadata.related_concepts) {
      const current = concepts.get(concept) ?? { count: 0, sources: new Set<string>() };
      current.count += 1;
      current.sources.add(metadata.title);
      concepts.set(concept, current);
    }
  }
  return Array.from(concepts.entries())
    .map(([concept, value]) => ({ concept, count: value.count, sources: Array.from(value.sources).sort() }))
    .sort((a, b) => b.count - a.count || a.concept.localeCompare(b.concept));
}

export async function suggestLinks(workspace: string): Promise<LinkSuggestion[]> {
  const concepts = await suggestConcepts(workspace);
  const suggestions: LinkSuggestion[] = [];
  for (const concept of concepts) {
    for (const source of concept.sources) {
      suggestions.push({
        source,
        concept: concept.concept,
        target: `wiki/concepts/${concept.concept}.md`
      });
    }
  }
  return suggestions.slice(0, 100);
}
