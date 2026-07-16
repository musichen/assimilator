import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".flac", ".aac", ".webm"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

export function isAudioOrVideoPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

export async function transcribeMediaToMarkdown(
  filePath: string,
  outputDir: string,
  options: { title?: string; sourceLabel?: string } = {},
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const title = options.title || path.basename(filePath, path.extname(filePath));
  const transcript = await transcribeWithWhisper(filePath, outputDir);
  const markdownPath = path.join(outputDir, `${safeName(title)}.transcript.md`);
  const markdown = [
    `# ${title}`,
    "",
    "## Source",
    "",
    `- File: ${filePath}`,
    options.sourceLabel ? `- Source: ${options.sourceLabel}` : "",
    "- Converter: local whisper CLI",
    "",
    "## Transcript",
    "",
    transcript.trim() || "No transcript text extracted.",
    "",
  ].filter(Boolean).join("\n");
  await fs.writeFile(markdownPath, markdown);
  return markdownPath;
}

async function transcribeWithWhisper(filePath: string, outputDir: string): Promise<string> {
  const whisperBin = process.env.ASSIMILATOR_WHISPER_BIN || "whisper";
  const basename = path.basename(filePath, path.extname(filePath));
  const txtPath = path.join(outputDir, `${basename}.txt`);
  const args = [
    filePath,
    "--model", process.env.ASSIMILATOR_WHISPER_MODEL || "base",
    "--output_format", "txt",
    "--output_dir", outputDir,
  ];
  const result = await execFileText(whisperBin, args, 30 * 60_000);
  if (result.exitCode !== 0) {
    throw new Error(`whisper failed: ${result.stderr || result.stdout}`.trim());
  }
  try {
    return await fs.readFile(txtPath, "utf8");
  } catch {
    const candidates = (await fs.readdir(outputDir))
      .filter((name) => name.endsWith(".txt"))
      .map((name) => path.join(outputDir, name));
    candidates.sort();
    const last = candidates.at(-1);
    if (!last) throw new Error("whisper completed but no transcript .txt was produced");
    return await fs.readFile(last, "utf8");
  }
}

function execFileText(command: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? error?.message ?? ""),
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      });
    });
  });
}

function safeName(value: string): string {
  return value.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180) || "transcript";
}
