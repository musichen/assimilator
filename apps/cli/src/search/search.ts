import fs from "node:fs/promises";
import path from "node:path";
import { listFiles } from "../core/fs.js";
import { relativeToWorkspace } from "../core/paths.js";

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export async function searchWorkspace(workspace: string, query: string): Promise<SearchMatch[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const roots = [path.join(workspace, "processed", "markdown"), path.join(workspace, "wiki")];
  const results: SearchMatch[] = [];
  for (const root of roots) {
    const files = await listFiles(root, new Set([".md"]));
    for (const filePath of files) {
      const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(trimmed)) {
          results.push({ file: relativeToWorkspace(workspace, filePath), line: index + 1, text: line.trim() });
        }
      });
    }
  }
  return results.slice(0, 100);
}
