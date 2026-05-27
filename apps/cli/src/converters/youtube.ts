import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { slugify } from "../core/ids.js";

const require = createRequire(import.meta.url);

export interface YoutubeConversionResult {
  markdown: string;
  title?: string;
  warnings: string[];
}

export function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

export async function convertYoutubeWithYtDlp(url: string): Promise<YoutubeConversionResult> {
  const command = process.env.ASSIMILATOR_YTDLP_BIN ?? require.resolve("yt-dlp-exec/bin/yt-dlp");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-youtube-"));
  const outputTemplate = path.join(tempDir, "%(id)s.%(ext)s");
  const metadata = await readYoutubeMetadata(command, url);

  await run(command, [
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "en.*,en",
    "--sub-format",
    "vtt",
    "-o",
    outputTemplate,
    url
  ]);

  const entries = await fs.readdir(tempDir);
  const subtitle = entries.find((entry) => entry.endsWith(".vtt"));
  if (!subtitle) {
    throw new Error("yt-dlp did not find subtitles or auto subtitles for this YouTube URL.");
  }

  const vtt = await fs.readFile(path.join(tempDir, subtitle), "utf8");
  const transcript = vttToText(vtt);
  if (!transcript.trim()) {
    throw new Error("yt-dlp produced an empty transcript.");
  }

  const title = metadata.title || slugify(url);
  const markdown = [
    `# ${title}`,
    "",
    "## Source",
    "",
    `- URL: ${url}`,
    metadata.uploader ? `- Channel: ${metadata.uploader}` : "",
    metadata.duration ? `- Duration: ${metadata.duration} seconds` : "",
    "",
    "## Transcript",
    "",
    transcript
  ].filter(Boolean).join("\n");

  return { markdown, title, warnings: [] };
}

export async function readYoutubeTitle(url: string): Promise<string | undefined> {
  const command = process.env.ASSIMILATOR_YTDLP_BIN ?? require.resolve("yt-dlp-exec/bin/yt-dlp");
  const metadata = await readYoutubeMetadata(command, url);
  return metadata.title;
}

export function vttToText(vtt: string): string {
  const seen = new Set<string>();
  const lines = vtt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      line !== "WEBVTT" &&
      !line.includes("-->") &&
      !/^(Kind|Language):/i.test(line) &&
      !/^\d+$/.test(line)
    )
    .map((line) => line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  return lines.join("\n");
}

async function readYoutubeMetadata(command: string, url: string): Promise<{ title?: string; uploader?: string; duration?: number }> {
  const stdout = await run(command, ["--dump-json", "--skip-download", url]);
  const firstLine = stdout.split(/\r?\n/).find(Boolean);
  if (!firstLine) return {};
  const raw = JSON.parse(firstLine) as { title?: string; uploader?: string; duration?: number };
  return {
    title: raw.title,
    uploader: raw.uploader,
    duration: raw.duration
  };
}

async function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`Unable to run ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
