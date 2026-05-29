import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { readConfig } from "./config.js";

// workspace_path in config overrides the default workspace_name path.
// Supports ~ expansion. Falls back to workspace_name resolved from CWD.
export async function resolveWorkspacePath(workspace?: string): Promise<string> {
  // 1. Explicit override passed in
  if (workspace) {
    return expandAndResolve(workspace);
  }
  // 2. Check ASSIMILATOR_WORKSPACE env var (already in DEFAULT_WORKSPACE)
  // 3. Try reading workspace_path from config file
  try {
    const cwd = process.cwd();
    const configPath = path.join(cwd, "assimilator.config.yaml");
    await fs.access(configPath);
    const config = await readConfig(cwd);
    if (config.workspace_path) {
      return expandAndResolve(config.workspace_path);
    }
  } catch {
    // no config file — fall through
  }
  // 4. Fall back to DEFAULT_WORKSPACE (which already reads ASSIMILATOR_WORKSPACE)
  return expandAndResolve(process.env.ASSIMILATOR_WORKSPACE ?? "knowledge-system");
}

function expandAndResolve(raw: string): string {
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

// Legacy sync export (kept for backward compat during transition)
export const DEFAULT_WORKSPACE = process.env.ASSIMILATOR_WORKSPACE ?? "knowledge-system";

export const resolveWorkspace = (workspace?: string): string => {
  // Sync version for code that hasn't migrated to async yet
  const raw = workspace ?? DEFAULT_WORKSPACE;
  return expandAndResolve(raw);
};

export const workspaceDirs = [
  "inbox/drop",
  "inbox/urls",
  "inbox/youtube",
  "inbox/books",
  "inbox/articles",
  "inbox/images",
  "inbox/screenshots",
  "inbox/repos",
  "inbox/manual-notes",
  "raw/web",
  "raw/youtube",
  "raw/books",
  "raw/pdfs",
  "raw/epub",
  "raw/mobi",
  "raw/docx",
  "raw/txt",
  "raw/markdown",
  "raw/html",
  "raw/images",
  "raw/audio",
  "raw/repos",
  "raw/datasets",
  "raw/transcripts",
  "raw/chats",
  "processed/markdown",
  "processed/html",
  "processed/extracted-text",
  "processed/ocr",
  "processed/transcripts",
  "processed/summaries",
  "processed/metadata",
  "processed/chunks",
  "wiki/concepts",
  "wiki/topics",
  "wiki/projects",
  "wiki/people",
  "wiki/companies",
  "wiki/tools",
  "wiki/books",
  "wiki/videos",
  "wiki/articles",
  "wiki/papers",
  "wiki/repos",
  "wiki/decisions",
  "wiki/questions",
  "wiki/commands",
  "wiki/daily-logs",
  "wiki/research-reports",
  "wiki/maps",
  "wiki/indexes",
  "portal/public",
  "portal/pages",
  "portal/assets",
  "portal/search-index",
  "portal/graph-index",
  "memory/cards",
  "memory/hindsight",
  "memory/hermes",
  "memory/exports",
  "logs/health-checks"
] as const;

export const requiredWikiIndexes = [
  "Home",
  "All Sources",
  "All Concepts",
  "All Books",
  "All Videos",
  "All Tools",
  "All Projects",
  "All Open Questions",
  "All Commands",
  "All Decisions",
  "Recently Updated",
  "Needs Review"
] as const;

export function relativeToWorkspace(workspace: string, filePath: string): string {
  return path.relative(workspace, filePath).split(path.sep).join("/");
}
