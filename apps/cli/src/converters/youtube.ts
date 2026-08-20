import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { slugify } from "../core/ids.js";

const require = createRequire(import.meta.url);

export interface YoutubeConversionResult {
  markdown: string;
  title?: string;
  warnings: string[];
}

export interface YoutubeConvertOptions {
  subLangs?: string;
  extractorArgs?: string;
}

/** Official + original captions only. Globs like `en.*` pull every auto-translation and 429 YouTube. */
export const DEFAULT_YOUTUBE_SUB_LANGS = "en,en-orig,ru,de";
export const RETRY_YOUTUBE_SUB_LANGS = "en,en-orig";
export const DEFAULT_YOUTUBE_EXTRACTOR_ARGS = "youtube:player_client=web,android";
export const RETRY_YOUTUBE_EXTRACTOR_ARGS = "youtube:player_client=android,ios";

export function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function resolveYtDlpCommand(): string {
  if (process.env.ASSIMILATOR_YTDLP_BIN) return process.env.ASSIMILATOR_YTDLP_BIN;
  try {
    return require.resolve("yt-dlp-exec/bin/yt-dlp");
  } catch {
    for (const candidate of ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"]) {
      if (candidate === "yt-dlp" || existsSync(candidate)) return candidate;
    }
    return "yt-dlp";
  }
}

export function buildYoutubeSubtitleArgs(
  url: string,
  outputTemplate: string,
  options: YoutubeConvertOptions = {},
): string[] {
  const subLangs = options.subLangs
    || process.env.ASSIMILATOR_YOUTUBE_SUB_LANGS
    || DEFAULT_YOUTUBE_SUB_LANGS;
  const extractorArgs = options.extractorArgs
    || process.env.ASSIMILATOR_YOUTUBE_EXTRACTOR_ARGS
    || DEFAULT_YOUTUBE_EXTRACTOR_ARGS;
  return [
    "--skip-download",
    "--no-playlist",
    "--force-ipv4",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    subLangs,
    "--ignore-errors",
    "--sub-format",
    "vtt",
    "--retries",
    "1",
    "--socket-timeout",
    "20",
    "--extractor-args",
    extractorArgs,
    "-o",
    outputTemplate,
    url,
  ];
}

export function resolveYtDlpEnv(): NodeJS.ProcessEnv {
  const venvBin = resolveAssimilatorVenvBin();
  const currentPath = process.env.PATH || "";
  if (!venvBin) return { ...process.env };
  const parts = currentPath.split(path.delimiter);
  if (parts.includes(venvBin)) return { ...process.env };
  return {
    ...process.env,
    PATH: `${venvBin}${path.delimiter}${currentPath}`,
  };
}

export async function convertYoutubeWithYtDlp(
  url: string,
  options: YoutubeConvertOptions = {},
): Promise<YoutubeConversionResult> {
  const command = resolveYtDlpCommand();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-youtube-"));
  const outputTemplate = path.join(tempDir, "%(id)s.%(ext)s");
  const warnings: string[] = [];

  // Metadata probe: bounded timeout so a hanging YouTube bot-check can't
  // stall the whole conversion indefinitely.
  let metadata: { title?: string; uploader?: string; duration?: number } = {};
  try {
    metadata = await readYoutubeMetadata(command, url);
  } catch (error) {
    warnings.push(`yt-dlp metadata probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await run(command, buildYoutubeSubtitleArgs(url, outputTemplate, options), {
      timeoutMs: youtubeSubtitlesTimeoutMs(),
    });

    const subtitle = await findPreferredSubtitle(tempDir);
    let transcript = "";
    let transcriptSource = "yt-dlp subtitles";

    if (subtitle) {
      const vtt = await fs.readFile(subtitle, "utf8");
      transcript = vttToText(vtt);
      if (!transcript.trim()) {
        warnings.push("yt-dlp found a subtitle file, but it was empty after VTT cleanup.");
      }
    } else {
      warnings.push("yt-dlp did not find subtitles or auto subtitles; falling back to local audio transcription.");
    }

    if (!transcript.trim()) {
      transcript = await transcribeYoutubeAudio(command, url, tempDir);
      transcriptSource = "local whisper audio transcription";
    }

    if (!transcript.trim()) {
      throw new Error("no transcript text was produced by subtitles or audio transcription.");
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
      `- Transcript source: ${transcriptSource}`,
      "",
      "## Transcript",
      "",
      transcript
    ].filter(Boolean).join("\n");

    return { markdown, title, warnings };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function readYoutubeTitle(url: string): Promise<string | undefined> {
  const command = resolveYtDlpCommand();
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
  const stdout = await run(command, ["--dump-json", "--skip-download", url], { timeoutMs: youtubeMetadataTimeoutMs() });
  const firstLine = stdout.split(/\r?\n/).find(Boolean);
  if (!firstLine) return {};
  const raw = JSON.parse(firstLine) as { title?: string; uploader?: string; duration?: number };
  return {
    title: raw.title,
    uploader: raw.uploader,
    duration: raw.duration
  };
}

async function transcribeYoutubeAudio(ytdlpCommand: string, url: string, tempDir: string): Promise<string> {
  const audioTemplate = path.join(tempDir, "audio.%(ext)s");
  await run(ytdlpCommand, [
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "-o",
    audioTemplate,
    url
  ], { timeoutMs: youtubeAudioDownloadTimeoutMs() });

  const audioPath = await findFirstFile(tempDir, (entry) => /\.(mp3|m4a|webm|opus|ogg|wav|aac)$/i.test(entry));
  if (!audioPath) {
    throw new Error("yt-dlp audio download completed but no audio file was found for local transcription.");
  }

  const whisperCommand = resolveWhisperCommand();
  await run(whisperCommand, [
    audioPath,
    "--model", process.env.ASSIMILATOR_WHISPER_MODEL || "base",
    "--output_format", "txt",
    "--output_dir", tempDir,
    "--verbose", "False",
  ], { timeoutMs: youtubeWhisperTimeoutMs() });

  const txtPath = path.join(tempDir, `${path.basename(audioPath, path.extname(audioPath))}.txt`);
  try {
    return (await fs.readFile(txtPath, "utf8")).trim();
  } catch {
    const transcriptPath = await findFirstFile(tempDir, (entry) => entry.endsWith(".txt"));
    if (!transcriptPath) {
      throw new Error("whisper completed but did not produce a .txt transcript.");
    }
    return (await fs.readFile(transcriptPath, "utf8")).trim();
  }
}

function resolveAssimilatorVenvBin(): string | undefined {
  if (process.env.ASSIMILATOR_VENV_BIN && existsSync(process.env.ASSIMILATOR_VENV_BIN)) {
    return process.env.ASSIMILATOR_VENV_BIN;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../../.venv/bin"),
    path.resolve(process.cwd(), ".venv/bin"),
    path.join(os.homedir(), "apps/assimilator/.venv/bin"),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "python")));
}

function resolveWhisperCommand(): string {
  if (process.env.ASSIMILATOR_WHISPER_BIN) return process.env.ASSIMILATOR_WHISPER_BIN;
  for (const candidate of ["/opt/homebrew/bin/whisper", "/usr/local/bin/whisper", "whisper"]) {
    if (candidate === "whisper" || existsSync(candidate)) return candidate;
  }
  return "whisper";
}

export function pickPreferredSubtitle(entries: string[]): string | undefined {
  const vtts = entries.filter((entry) => entry.endsWith(".vtt"));
  return vtts.find((entry) => /\.en-orig\.vtt$/i.test(entry))
    || vtts.find((entry) => /\.en\.vtt$/i.test(entry))
    || vtts[0];
}

async function findPreferredSubtitle(dir: string): Promise<string | undefined> {
  const match = pickPreferredSubtitle(await fs.readdir(dir));
  return match ? path.join(dir, match) : undefined;
}

async function findFirstFile(dir: string, predicate: (entry: string) => boolean): Promise<string | undefined> {
  const entries = await fs.readdir(dir);
  const match = entries.find(predicate);
  return match ? path.join(dir, match) : undefined;
}

function youtubeAudioDownloadTimeoutMs(): number {
  return parsePositiveInt(process.env.ASSIMILATOR_YOUTUBE_AUDIO_TIMEOUT_MS, 10 * 60_000);
}

function youtubeSubtitlesTimeoutMs(): number {
  return parsePositiveInt(process.env.ASSIMILATOR_YOUTUBE_SUBTITLES_TIMEOUT_MS, 3 * 60_000);
}

function youtubeMetadataTimeoutMs(): number {
  return parsePositiveInt(process.env.ASSIMILATOR_YOUTUBE_METADATA_TIMEOUT_MS, 45_000);
}

function youtubeWhisperTimeoutMs(): number {
  return parsePositiveInt(process.env.ASSIMILATOR_YOUTUBE_WHISPER_TIMEOUT_MS, 45 * 60_000);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function run(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: resolveYtDlpEnv() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGTERM");
          setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
          reject(new Error(`${command} timed out after ${Math.round(options.timeoutMs! / 1000)}s`));
        }, options.timeoutMs)
      : undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(new Error(`Unable to run ${command}: ${error.message}`)));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      });
    });
  });
}
