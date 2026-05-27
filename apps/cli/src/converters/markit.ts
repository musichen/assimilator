import { spawn } from "node:child_process";
import { Markit } from "markit-ai";

export interface MarkitAdapterResult {
  markdown: string;
  title?: string;
  warnings: string[];
}

export async function findMarkitCommand(): Promise<string[] | null> {
  if (process.env.ASSIMILATOR_MARKIT_BIN) {
    return process.env.ASSIMILATOR_MARKIT_BIN.split(/\s+/).filter(Boolean);
  }
  return null;
}

export async function convertWithMarkitLibrary(inputPath: string): Promise<MarkitAdapterResult> {
  const markit = new Markit();
  const result = await markit.convertFile(inputPath);
  return {
    markdown: result.markdown,
    title: result.title,
    warnings: []
  };
}

export async function convertUrlWithMarkitLibrary(url: string): Promise<MarkitAdapterResult> {
  const markit = new Markit();
  const result = await markit.convertUrl(url);
  return {
    markdown: result.markdown,
    title: result.title,
    warnings: []
  };
}

export async function convertWithMarkitCli(inputPath: string, command: string[]): Promise<MarkitAdapterResult> {
  const [executable, ...baseArgs] = command;
  if (!executable) {
    throw new Error("Invalid Markit command.");
  }
  const markdown = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...baseArgs, inputPath, "-q"], {
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
      reject(new Error(`Unable to run Markit command "${command.join(" ")}": ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `markit exited with code ${code}`));
      }
    });
  });
  return { markdown, warnings: [] };
}
