import fs from "node:fs/promises";
import path from "node:path";
import { hashFile } from "../core/hashing.js";
import { listFiles } from "../core/fs.js";
import { slugify } from "../core/ids.js";

export interface LibraryInventoryItem {
  path: string;
  title: string;
  author: string;
  format: string;
  size: number;
  hash: string;
  possible_language: string;
  duplicate_group: string;
  topic_guesses: string[];
  processing_status: "inventoried";
  privacy_level: "private";
}

export interface LibraryInventoryResult {
  items: LibraryInventoryItem[];
  jsonlPath: string;
  markdownPath: string;
}

const bookExtensions = new Set([".pdf", ".epub", ".mobi", ".azw", ".azw3", ".djvu", ".docx", ".txt", ".md"]);

export async function inventoryLibrary(workspace: string, libraryPath: string): Promise<LibraryInventoryResult> {
  const absoluteLibrary = path.resolve(libraryPath);
  const files = (await listFiles(absoluteLibrary, bookExtensions)).sort();
  const items: LibraryInventoryItem[] = [];
  const hashes = new Map<string, number>();

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const hash = await hashFile(filePath);
    hashes.set(hash, (hashes.get(hash) ?? 0) + 1);
    const parsed = parseBookName(filePath);
    items.push({
      path: filePath,
      title: parsed.title,
      author: parsed.author,
      format: path.extname(filePath).slice(1).toLowerCase() || "unknown",
      size: stat.size,
      hash,
      possible_language: "unknown",
      duplicate_group: hash,
      topic_guesses: guessTopics(filePath),
      processing_status: "inventoried",
      privacy_level: "private"
    });
  }

  const jsonlPath = path.join(workspace, "processed", "metadata", "library-inventory.jsonl");
  const markdownPath = path.join(workspace, "wiki", "indexes", "Library Inventory.md");
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(jsonlPath, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""));
  await fs.writeFile(markdownPath, [
    "# Library Inventory",
    "",
    `Items inventoried: ${items.length}`,
    "",
    "This is inventory only. No full book ingestion was performed.",
    "",
    ...items.slice(0, 250).map((item) => `- ${item.title} (${item.format}, ${item.size} bytes, duplicate group ${item.duplicate_group.slice(0, 12)})`)
  ].join("\n"));

  return { items, jsonlPath, markdownPath };
}

function parseBookName(filePath: string): { title: string; author: string } {
  const name = path.basename(filePath, path.extname(filePath));
  const parts = name.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { author: parts[0] ?? "", title: parts.slice(1).join(" - ") };
  }
  return { author: "", title: name };
}

function guessTopics(filePath: string): string[] {
  return slugify(path.basename(filePath, path.extname(filePath)))
    .split("-")
    .filter((part) => part.length > 3)
    .slice(0, 5);
}
