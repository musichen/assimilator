import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DefuddleConversionResult {
  markdown: string;
  title?: string;
  author?: string;
  description?: string;
  warnings: string[];
}

interface DefuddleCliJson {
  content?: string;
  title?: string;
  author?: string;
  description?: string;
}

export async function convertUrlWithDefuddle(url: string): Promise<DefuddleConversionResult> {
  const command = resolveDefuddleCommand();
  const parsed = await runDefuddleJson(command, url);
  const markdown = String(parsed.content ?? "").trim();
  if (!markdown) {
    throw new Error("Defuddle extracted empty content");
  }

  return {
    markdown,
    title: cleanString(parsed.title),
    author: cleanString(parsed.author),
    description: cleanString(parsed.description),
    warnings: []
  };
}

function resolveDefuddleCommand(): string {
  if (process.env.ASSIMILATOR_DEFUDDLE_BIN) {
    return process.env.ASSIMILATOR_DEFUDDLE_BIN;
  }
  const projectLocal = path.resolve(process.cwd(), "node_modules", ".bin", "defuddle");
  if (fs.existsSync(projectLocal)) return projectLocal;
  const repoLocal = path.resolve(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "defuddle");
  if (fs.existsSync(repoLocal)) return repoLocal;
  return "defuddle";
}

async function runDefuddleJson(command: string, url: string): Promise<DefuddleCliJson> {
  const timeoutMs = Number(process.env.ASSIMILATOR_DEFUDDLE_TIMEOUT_MS ?? 45000);
  return await new Promise<DefuddleCliJson>((resolve, reject) => {
    const child = spawn(command, ["parse", "--md", "--json", url], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Defuddle respects this flag through its CLI fetch path.
        ASSIMILATOR_DEFUDDLE_TIMEOUT_MS: String(timeoutMs),
      },
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Defuddle timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Unable to run Defuddle command "${command}": ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `defuddle exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as DefuddleCliJson);
      } catch (error) {
        reject(new Error(`Defuddle returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
