import fs from "node:fs/promises";
import path from "node:path";
import type { SourceMetadata } from "../core/schemas.js";
import { listFiles, pathExists } from "../core/fs.js";

export async function writeWikiSourcePage(workspace: string, metadata: SourceMetadata, artifactMarkdown: string): Promise<string> {
  const wikiPath = path.join(workspace, "wiki", "articles", `${metadata.title}.md`);
  await fs.mkdir(path.dirname(wikiPath), { recursive: true });
  await fs.writeFile(wikiPath, artifactMarkdown);
  return wikiPath;
}

export async function ensureConceptPages(workspace: string, metadata: SourceMetadata): Promise<void> {
  for (const concept of metadata.related_concepts) {
    const conceptPath = path.join(workspace, "wiki", "concepts", `${concept}.md`);
    if (await pathExists(conceptPath)) continue;
    const body = [
      "---",
      `title: ${concept}`,
      "type: concept",
      "status: stub",
      `updated: ${metadata.updated_at}`,
      "---",
      "",
      `# ${concept}`,
      "",
      "## Summary",
      "",
      "Needs review and enrichment.",
      "",
      "## Related Sources",
      "",
      `- [[${metadata.title}]]`,
      ""
    ].join("\n");
    await fs.writeFile(conceptPath, body);
  }
}

export async function updateWikiIndexes(workspace: string): Promise<void> {
  const metadataDir = path.join(workspace, "processed", "metadata");
  const metadataFiles = await listFiles(metadataDir, new Set([".json"]));
  const sourceRows: string[] = [];
  for (const filePath of metadataFiles.sort()) {
    const metadata = JSON.parse(await fs.readFile(filePath, "utf8")) as SourceMetadata;
    sourceRows.push(`- [[${metadata.title}]] - ${metadata.source_type} - ${metadata.ingested_at}`);
  }
  const allSources = ["# All Sources", "", sourceRows.length ? sourceRows.join("\n") : "_No sources ingested yet._", ""].join("\n");
  await fs.writeFile(path.join(workspace, "wiki", "indexes", "All Sources.md"), allSources);

  const conceptFiles = await listFiles(path.join(workspace, "wiki", "concepts"), new Set([".md"]));
  const conceptRows = conceptFiles.sort().map((filePath) => `- [[${path.basename(filePath, ".md")}]]`);
  const allConcepts = ["# All Concepts", "", conceptRows.length ? conceptRows.join("\n") : "_No concepts extracted yet._", ""].join("\n");
  await fs.writeFile(path.join(workspace, "wiki", "indexes", "All Concepts.md"), allConcepts);

  const home = [
    "# Home",
    "",
    "## Recent Sources",
    "",
    sourceRows.slice(-10).reverse().join("\n") || "_No sources ingested yet._",
    "",
    "## Navigation",
    "",
    "- [[All Sources]]",
    "- [[All Concepts]]",
    "- [[All Commands]]",
    "- [[All Open Questions]]",
    "- [[Recently Updated]]",
    "- [[Needs Review]]",
    ""
  ].join("\n");
  await fs.writeFile(path.join(workspace, "wiki", "indexes", "Home.md"), home);

  const recentlyUpdated = ["# Recently Updated", "", sourceRows.slice(-25).reverse().join("\n") || "_No entries yet._", ""].join("\n");
  await fs.writeFile(path.join(workspace, "wiki", "indexes", "Recently Updated.md"), recentlyUpdated);
}
