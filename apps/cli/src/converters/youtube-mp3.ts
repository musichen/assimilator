import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

// ── Types ─────────────────────────────────────────────────────────────

export interface YoutubeMp3Result {
  /** Absolute path to the MP3 file */
  filePath: string;
  /** YouTube video title (used as filename) */
  title: string;
  /** File size in bytes */
  size: number;
}

export interface YoutubePlaylistMp3Result {
  /** All successfully converted items */
  items: YoutubeMp3Result[];
  /** Any items that failed */
  errors: { title: string; error: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────

const YTDLP = resolveYtDlpCommand();
const DEFAULT_MP3_AUDIO_QUALITY = process.env.ASSIMILATOR_MP3_AUDIO_QUALITY ?? "64K";

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

export function isYoutubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "youtube.com" ||
      u.hostname === "www.youtube.com" ||
      u.hostname === "youtu.be" ||
      u.hostname === "music.youtube.com"
    );
  } catch {
    return false;
  }
}

export function isYoutubePlaylistUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "youtube.com" || u.hostname === "www.youtube.com") &&
      u.pathname === "/playlist" &&
      u.searchParams.has("list")
    );
  } catch {
    return false;
  }
}

export interface YtDlpOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Run yt-dlp and return stdout as string. */
async function ytdlp(args: string[], opts?: YtDlpOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutMs = opts?.timeoutMs ?? ytDlpDownloadTimeoutMs();
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
        reject(new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);

    const cleanup = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
      }
    };

    opts?.signal?.addEventListener("abort", cleanup, { once: true });

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts?.signal?.aborted) reject(new Error("ABORTED"));
      else reject(new Error(`yt-dlp: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts?.signal?.aborted) reject(new Error("ABORTED"));
      else if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `yt-dlp exited ${code}`));
    });
  });
}

/**
 * Run yt-dlp with real-time progress parsing from stderr.
 * Calls onProgress with percentage strings like "▐███▌  42% · 2.1 MiB/s"
 */
async function ytdlpProgress(
  args: string[],
  onProgress?: (msg: string) => void,
  opts?: YtDlpOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutMs = opts?.timeoutMs ?? ytDlpDownloadTimeoutMs();
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
        reject(new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);

    const cleanup = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
      }
    };

    opts?.signal?.addEventListener("abort", cleanup, { once: true });

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;

      // Parse download progress: "[download]  42.3% of  3.99MiB at  1.42MiB/s ETA 00:02"
      const match = text.match(/\[download\]\s+([\d.]+%)\s+of\s+(.+?)\s+at\s+(.+?)(?:\s+ETA\s+(\S+))?/);
      if (match) {
        const pct = match[1]!;
        const size = match[2];
        const speed = (match[3] ?? "?").replace(/\s+/g, "");
        const eta = match[4] ?? "?";
        const barLen = 12;
        const filled = Math.round((parseFloat(pct) / 100) * barLen);
        const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
        onProgress?.(`${bar} ${pct.padStart(5)} · ${speed} · ETA ${eta}`);
      }

      const extractMatch = text.match(/\[ExtractAudio\]\s+Destination:\s*(.+)/);
      if (extractMatch) {
        onProgress?.("Converting to MP3...");
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts?.signal?.aborted) reject(new Error("ABORTED"));
      else reject(new Error(`yt-dlp: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts?.signal?.aborted) reject(new Error("ABORTED"));
      else if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `yt-dlp exited ${code}`));
    });
  });
}

function playlistTrackDelayMs(): number {
  const raw = Number.parseInt(process.env.ASSIMILATOR_PLAYLIST_TRACK_DELAY_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 8_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ytDlpDownloadTimeoutMs(): number {
  const raw = Number.parseInt(process.env.ASSIMILATOR_YOUTUBE_MP3_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 60_000;
}

function safeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 200) || "untitled";
}

/** Strip playlist/radio params from a YouTube video URL so yt-dlp downloads only the one video. */
function cleanVideoUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return url; // short links are always single video
    // Remove playlist/radio/mix params that make yt-dlp download the whole mix
    u.searchParams.delete("list");
    u.searchParams.delete("start_radio");
    u.searchParams.delete("index");
    return u.toString();
  } catch {
    return url;
  }
}

// ── Single video ──────────────────────────────────────────────────────

/**
 * Download a single YouTube video as MP3.
 * Uses yt-dlp to extract best audio, convert to MP3 via ffmpeg,
 * embed thumbnail and metadata. Filename = video title.
 */
export async function youtubeToMp3(
  url: string,
  outputDir: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<YoutubeMp3Result> {
  await fs.mkdir(outputDir, { recursive: true });
  if (signal?.aborted) throw new Error("ABORTED");

  const cleanUrl = cleanVideoUrl(url);

  onProgress?.("🔍 Fetching video info...");
  // IMPORTANT: the metadata fetch must use the same non-blocked player client.
  // The default web client gets 403/rate-limited by YouTube and can hang for
  // the full timeout; android/ios clients are not blocked.
  const infoJson = await ytdlp([
    "--dump-json",
    "--skip-download",
    "--extractor-args", "youtube:player_client=android,ios",
    cleanUrl,
  ], { signal });
  const info = JSON.parse(infoJson.split(/\r?\n/).find(Boolean) ?? "{}") as {
    title?: string;
    uploader?: string;
  };
  const title = info.title || "Unknown";
  const filename = safeFilename(title);

  onProgress?.(`⬇ ${title}`);

  const filePath = path.join(outputDir, `${filename}.mp3`);
  await fs.rm(filePath, { force: true });

  const outputTemplate = path.join(outputDir, `${filename}.%(ext)s`);
  await ytdlpProgress([
    "-f", "bestaudio/best",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", DEFAULT_MP3_AUDIO_QUALITY,
    "--retries", "5",
    "--retry-sleep", "5",
    "--extractor-retries", "5",
    // YouTube blocks the web player client (HTTP 403 on video data).
    // The android client is not blocked and serves a direct mp4/m4a stream.
    "--extractor-args", "youtube:player_client=android,ios",
    "--add-metadata",
    "--embed-thumbnail",
    "--newline",
    "-o", outputTemplate,
    cleanUrl,
  ], onProgress, { signal });

  const stat = await fs.stat(filePath);

  onProgress?.(`✅ ${filename} · ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

  return { filePath, title, size: stat.size };
}

// ── Playlist ──────────────────────────────────────────────────────────

/**
 * Download an entire YouTube playlist as MP3 files.
 * Each file gets the video title as filename with embedded metadata.
 */
export async function youtubePlaylistToMp3(
  playlistUrl: string,
  outputDir: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<YoutubePlaylistMp3Result> {
  await fs.mkdir(outputDir, { recursive: true });
  if (signal?.aborted) throw new Error("ABORTED");

  onProgress?.("🔍 Fetching playlist info...");
  const flatJson = await ytdlp([
    "--flat-playlist",
    "--dump-json",
    "--skip-download",
    "--extractor-args", "youtube:player_client=android,ios",
    playlistUrl,
  ], { signal });

  const entries = flatJson
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as { title?: string; id?: string }; }
      catch { return null; }
    })
    .filter((e): e is { title?: string; id: string } => e !== null && e.id !== undefined);

  onProgress?.(`📋 Playlist: ${entries.length} tracks`);

  const items: YoutubeMp3Result[] = [];
  const errors: { title: string; error: string }[] = [];

  let idx = 0;
  for (const entry of entries) {
    idx++;
    const videoUrl = `https://www.youtube.com/watch?v=${entry.id!}`;
    const label = entry.title || `#${idx}`;
    onProgress?.(`[${idx}/${entries.length}] ⬇ ${label}`);

    try {
      // Delegate to single-video download — progress bars stream through
      const prefix = `[${idx}/${entries.length}] `;
      const result = await youtubeToMp3(videoUrl, outputDir, (msg) => onProgress?.(`${prefix}${msg}`), signal);
      items.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ title: label, error: msg });
      onProgress?.(`[${idx}/${entries.length}] ❌ ${label} — ${msg}`);
    }

    // Rate-limit protection: YouTube 403s rapid back-to-back downloads.
    if (idx < entries.length && !signal?.aborted) {
      const delayMs = playlistTrackDelayMs();
      onProgress?.(`⏳ ${Math.round(delayMs / 1000)}s pause before next track...`);
      await sleep(delayMs);
    }
  }

  const summary = `✅ ${items.length}/${entries.length} done`;
  onProgress?.(summary);
  if (errors.length > 0) {
    onProgress?.(`❌ ${errors.length} failed: ${errors.map(e => e.title).join(", ")}`);
  }

  return { items, errors };
}
