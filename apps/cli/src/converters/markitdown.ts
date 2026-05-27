import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface MarkitdownResult {
  markdown: string;
  title?: string;
  warnings: string[];
}

export async function convertWithMarkitdownCli(input: string): Promise<MarkitdownResult> {
  const command = findProjectMarkitdownCommand();
  const markdown = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, [input], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`Unable to run MarkItDown command "${command}": ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `markitdown exited with code ${code}`));
    });
  });
  return { markdown, warnings: [] };
}

function findProjectMarkitdownCommand(): string {
  if (process.env.ASSIMILATOR_MARKITDOWN_BIN) {
    return process.env.ASSIMILATOR_MARKITDOWN_BIN;
  }
  const projectLocal = path.resolve(".venv", "bin", "markitdown");
  if (fs.existsSync(projectLocal)) {
    return projectLocal;
  }
  throw new Error("Microsoft MarkItDown fallback is not installed in the project. Run `pnpm setup:python-tools` first, or set ASSIMILATOR_MARKITDOWN_BIN explicitly.");
}
