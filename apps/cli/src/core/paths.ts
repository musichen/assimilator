import path from "node:path";
import os from "node:os";

// ASSIMILATOR_WORKSPACE env var overrides the default — lets users point
// at an external drive or shared vault without passing --workspace every time.
export const DEFAULT_WORKSPACE = process.env.ASSIMILATOR_WORKSPACE ?? "knowledge-system";

export function resolveWorkspace(workspace?: string): string {
  const raw = workspace ?? DEFAULT_WORKSPACE;
  const expanded = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

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
