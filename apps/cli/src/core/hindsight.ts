import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface HindsightIngestResult {
  sourcePath: string;
  exportPath: string;
  ok: boolean;
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

const DEFAULT_BANK_ID = "hermes-default";
const DEFAULT_KB_ROOT = path.join(os.homedir(), ".hindsight", "memory-imports", "knowledgebase", "assimilator");

export async function exportAndRetainInHindsight(
  sourcePath: string,
  options: {
    bankId?: string;
    context?: string;
    sourceId?: string;
    title?: string;
    sourceType?: string;
    async?: boolean;
  } = {},
): Promise<HindsightIngestResult> {
  const absoluteSource = path.resolve(sourcePath);
  const stat = await fs.stat(absoluteSource);
  if (!stat.isFile()) throw new Error(`Hindsight source is not a file: ${sourcePath}`);

  const bankId = options.bankId ?? process.env.ASSIMILATOR_HINDSIGHT_BANK ?? DEFAULT_BANK_ID;
  const exportPath = await copyToCollisionSafeHindsightPath(absoluteSource, {
    sourceId: options.sourceId,
    title: options.title,
  });
  const context = options.context ?? buildHindsightContext(options);
  const command = ["memory", "retain-files", bankId, exportPath, "--context", context, "-o", "json"];
  if (options.async ?? true) command.push("--async");

  const result = await runHindsight(command);
  return {
    sourcePath: absoluteSource,
    exportPath,
    ok: result.exitCode === 0,
    command: ["hindsight", ...command],
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    error: result.exitCode === 0 ? undefined : (result.stderr || result.stdout || `hindsight exited ${result.exitCode}`),
  };
}

async function copyToCollisionSafeHindsightPath(
  sourcePath: string,
  options: { sourceId?: string; title?: string },
): Promise<string> {
  await fs.mkdir(DEFAULT_KB_ROOT, { recursive: true });
  const ext = path.extname(sourcePath) || ".md";
  const base = safeSegment(options.title || path.basename(sourcePath, ext));
  const id = safeSegment(options.sourceId || base).slice(0, 24);
  const filename = `${id}__${base}${ext}`;
  const dest = path.join(DEFAULT_KB_ROOT, filename);
  await fs.copyFile(sourcePath, dest);
  return dest;
}

function buildHindsightContext(options: { sourceId?: string; title?: string; sourceType?: string }): string {
  return [
    "source=assimilator",
    options.sourceId ? `source_id=${options.sourceId}` : "",
    options.sourceType ? `source_type=${options.sourceType}` : "",
    options.title ? `title=${options.title}` : "",
    "purpose=converted-media-and-documents-to-source-linked-memory",
  ].filter(Boolean).join("; ");
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "assimilator-source";
}

function runHindsight(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile("hindsight", args, { timeout: 120_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? error?.message ?? ""),
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      });
    });
  });
}
