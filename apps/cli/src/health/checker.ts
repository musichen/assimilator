import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { listFiles, pathExists } from "../core/fs.js";
import { relativeToWorkspace } from "../core/paths.js";
import type { SourceMetadata } from "../core/schemas.js";

export interface HealthIssue {
  severity: "info" | "warning" | "error";
  rule: string;
  message: string;
  file?: string;
}

export interface HealthCheckResult {
  issues: HealthIssue[];
  markdownPath: string;
  jsonPath: string;
}

export async function runHealthCheck(workspace: string): Promise<HealthCheckResult> {
  const issues: HealthIssue[] = [];
  const metadataFiles = await listFiles(path.join(workspace, "processed", "metadata"), new Set([".json"]));
  const sourceMarkdownPaths = new Set<string>();
  for (const filePath of metadataFiles) {
    if (path.basename(filePath) === "library-inventory.jsonl") continue;
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as SourceMetadata;
    if (!raw.local_raw_path || !(await pathExists(path.join(workspace, raw.local_raw_path)))) {
      issues.push({ severity: "error", rule: "raw-source-present", message: `Missing raw source for ${raw.id ?? filePath}`, file: relativeToWorkspace(workspace, filePath) });
    }
    if (!raw.processed_markdown_path || !(await pathExists(path.join(workspace, raw.processed_markdown_path)))) {
      issues.push({ severity: "error", rule: "processed-markdown-present", message: `Missing processed markdown for ${raw.id ?? filePath}`, file: relativeToWorkspace(workspace, filePath) });
    } else {
      sourceMarkdownPaths.add(raw.processed_markdown_path);
    }
    if (!raw.summary_short?.trim()) {
      issues.push({ severity: "warning", rule: "metadata-summary-present", message: `Missing short summary for ${raw.id}`, file: relativeToWorkspace(workspace, filePath) });
    }
    if (raw.privacy_level === "sensitive" && raw.source_url) {
      issues.push({ severity: "warning", rule: "sensitive-source-url-review", message: `Sensitive source has external URL metadata`, file: relativeToWorkspace(workspace, filePath) });
    }
  }

  const wikiFiles = await listFiles(path.join(workspace, "wiki"), new Set([".md"]));
  const wikiNames = new Set(wikiFiles.map((filePath) => path.basename(filePath, ".md")));
  const backedWikiArticleNames = new Set(Array.from(sourceMarkdownPaths).map((filePath) => path.basename(filePath, ".md")));
  for (const filePath of wikiFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = matter(content);
    const relative = relativeToWorkspace(workspace, filePath);
    for (const match of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const target = match[1];
      if (target && !wikiNames.has(target)) {
        issues.push({ severity: "warning", rule: "wikilink-target-exists", message: `Broken or unresolved wikilink: [[${target}]]`, file: relative });
      }
    }
    if (content.length > 80_000) {
      issues.push({ severity: "info", rule: "page-size-review", message: "Large page may need splitting", file: relative });
    }
    if (/Needs review and enrichment|Needs human or agent review/i.test(content)) {
      issues.push({ severity: "info", rule: "needs-review", message: "Page contains review placeholder text", file: relative });
    }
    if (relative.startsWith("wiki/articles/") && !backedWikiArticleNames.has(path.basename(filePath, ".md"))) {
      issues.push({ severity: "warning", rule: "wiki-page-source-support", message: "Article wiki page may not have source metadata support", file: relative });
    }
    if (parsed.data.type === "concept" && !/## Related Sources\s+\n\s*- \[\[/m.test(content)) {
      issues.push({ severity: "info", rule: "concept-source-links", message: "Concept page has no related source links", file: relative });
    }
  }

  const memoryFiles = await listFiles(path.join(workspace, "memory"), new Set([".jsonl"]));
  for (const filePath of memoryFiles) {
    const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      try {
        const card = JSON.parse(line) as { source_reference?: string; source_id?: string };
        if (!card.source_reference || !card.source_id) {
          issues.push({ severity: "error", rule: "memory-card-source-reference", message: `Memory card missing source linkage on line ${index + 1}`, file: relativeToWorkspace(workspace, filePath) });
        }
      } catch {
        issues.push({ severity: "error", rule: "memory-card-jsonl-valid", message: `Invalid memory JSONL on line ${index + 1}`, file: relativeToWorkspace(workspace, filePath) });
      }
    });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(workspace, "logs", "health-checks");
  await fs.mkdir(reportDir, { recursive: true });
  const markdownPath = path.join(reportDir, `${timestamp}.md`);
  const jsonPath = path.join(reportDir, `${timestamp}.json`);
  const markdown = [
    "# ASSIMILATOR Health Check",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Issues: ${issues.length}`,
    "",
    ...issues.map((issue) => `- **${issue.severity}** ${issue.rule}: ${issue.message}${issue.file ? ` (${issue.file})` : ""}`),
    ""
  ].join("\n");
  await fs.writeFile(markdownPath, markdown);
  await fs.writeFile(jsonPath, `${JSON.stringify({ issues }, null, 2)}\n`);
  return { issues, markdownPath, jsonPath };
}
