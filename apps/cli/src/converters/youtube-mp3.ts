import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveYtDlpEnv } from "./youtube.js";

const require = createRequire(import.meta.url);

export interface YoutubeMp3Result {
  filePath: string;
  title: string;
  size: number;
}

export interface YoutubePlaylistMp3Result {
  items: YoutubeMp3Result[];
  errors: { title: string; error: string }[];
}

export interface YtDlpOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const YTDLP = resolveYtDlpCommand();
const DEFAULT_MP3_AUDIO_QUALITY = process.env.ASSIMILATOR_MP3_AUDIO_QUALITY ?? "64K";
export const YOUTUBE_MP3_PLAYER_CLIENTS = "tv,web_embedded";
export const YOUTUBE_METADATA_TIMEOUT_MS = 25_000;
export const YOUTUBE_DOWNLOAD_STALL_MS = 45_000;
export const YOUTUBE_DOWNLOAD_TIMEOUT_MS = 180_000;

function resolveYtDlpCommand(): string {
  if (process.env.ASSIMILATOR_YTDLP_BIN && existsSync(process.env.ASSIMILATOR_YTDLP_BIN)) {
    return process.env.ASSIMILATOR_YTDLP_BIN;
  }
  const pinned = [
    path.join(os.homedir(), "apps/assimilator/bin/yt-dlp"),
    path.resolve(process.cwd(), "bin/yt-dlp"),
  ].find((p) => existsSync(p));
  if (pinned) return pinned;
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

/** Extract the 11-char video id from any common YouTube URL. */
export function extractYoutubeVideoId(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id && id.length === 11 ? id : undefined;
    }
    const v = u.searchParams.get("v");
    if (v && v.length === 11) return v;
    const short = u.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    return short?.[2];
  } catch {
    return undefined;
  }
}

/** Strip tracking/playlist junk so yt-dlp never treats a share link as a mix. */
export function cleanVideoUrl(url: string): string {
  const id = extractYoutubeVideoId(url);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return url;
}

function commonYoutubeArgs(): string[] {
  return [
    "--no-playlist",
    "--force-ipv4",
    "--socket-timeout", "15",
    "--retries", "1",
    "--js-runtimes", "node",
    "--extractor-args", `youtube:player_client=${YOUTUBE_MP3_PLAYER_CLIENTS}`,
  ];
}

async function ytdlp(args: string[], opts?: YtDlpOptions): Promise<string> {
  return spawnYtDlp(args, undefined, opts);
}

/**
 * Parse a single "[download] ..." progress line from yt-dlp.
 */
export function parseYtDlpProgressLine(line: string): { pct: string; size: string; speed: string; eta: string } | null {
  const m = line.match(/\[download\]\s+([\d.]+%)\s+of\s+(\S+)\s+at\s+(.+?)\s+ETA\s+(\S+)/);
  if (!m) return null;
  return {
    pct: m[1]!,
    size: m[2]!,
    speed: m[3]!.replace(/\s+/g, ""),
    eta: m[4]!,
  };
}

export function formatProgressBar(line: string): string | undefined {
  const progress = parseYtDlpProgressLine(line);
  if (progress) {
    const { pct, size, speed, eta } = progress;
    const barLen = 12;
    const filled = Math.min(barLen, Math.round((parseFloat(pct) / 100) * barLen));
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    return `${bar} ${pct.padStart(5)} · ${size} · ${speed} · ETA ${eta}`;
  }
  if (/\[ExtractAudio\]/.test(line)) return "🎙 Converting to MP3…";
  if (/\[ffmpeg\]/.test(line) && /Destination/.test(line)) return "🎙 Encoding MP3…";
  if (/\[youtube\].*Downloading/i.test(line)) return `📡 ${line.replace(/^\[youtube\]\s*/, "").slice(0, 80)}`;
  if (/\[info\]/.test(line)) return `ℹ ${line.replace(/^\[info\]\s*/, "").slice(0, 90)}`;
  if (/WARNING:/.test(line) && /403|429|PO Token|SABR/i.test(line)) {
    return `⚠ ${line.replace(/^WARNING:\s*/, "").slice(0, 90)}`;
  }
  return undefined;
}

async function ytdlpProgress(
  args: string[],
  onProgress?: (msg: string) => void,
  opts?: YtDlpOptions,
): Promise<string> {
  return spawnYtDlp(args, onProgress, opts);
}

function spawnYtDlp(
  args: string[],
  onProgress?: (msg: string) => void,
  opts?: YtDlpOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: resolveYtDlpEnv(),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastProgressAt = Date.now();
    let lastProgressMsg = "";

    const timeoutMs = opts?.timeoutMs ?? ytDlpDownloadTimeoutMs();
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(heartbeat);
        child.kill("SIGTERM");
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
        reject(new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s${stderr ? `: ${stderr.trim().split(/\n/).slice(-4).join(" | ")}` : ""}`));
      }
    }, timeoutMs);

    const heartbeat = setInterval(() => {
      if (settled || !onProgress) return;
      const silentFor = Date.now() - lastProgressAt;
      if (silentFor >= 3000) {
        const elapsed = Math.round((Date.now() - (Date.now() - silentFor)) / 1000);
        void elapsed;
        onProgress(`${lastProgressMsg || "working…"} · still running ${Math.round(silentFor / 1000)}s`);
      }
    }, 3000);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      fn();
    };

    const cleanup = () => {
      finish(() => {
        child.kill("SIGTERM");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
      });
    };

    opts?.signal?.addEventListener("abort", cleanup, { once: true });

    let lineBuffer = "";
    const onData = (chunk: Buffer) => {
      lineBuffer += String(chunk);
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const formatted = formatProgressBar(line);
        if (formatted) {
          lastProgressAt = Date.now();
          lastProgressMsg = formatted;
          onProgress?.(formatted);
        }
      }
    };

    child.stdout.on("data", (chunk) => { stdout += String(chunk); onData(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); onData(chunk); });
    child.on("error", (err) => {
      finish(() => {
        if (opts?.signal?.aborted) reject(new Error("ABORTED"));
        else reject(new Error(`yt-dlp: ${err.message}`));
      });
    });
    child.on("close", (code) => {
      finish(() => {
        if (opts?.signal?.aborted) reject(new Error("ABORTED"));
        else if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `yt-dlp exited ${code}`));
      });
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
  return Number.isFinite(raw) && raw > 0 ? raw : YOUTUBE_DOWNLOAD_TIMEOUT_MS;
}

function safeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 200) || "untitled";
}

/**
 * Download a single YouTube video as MP3.
 * Metadata probe is hard-capped at 25s — if YouTube hangs, we still download.
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
  const videoId = extractYoutubeVideoId(cleanUrl) || `yt-${Date.now()}`;

  onProgress?.(`mp3-v3 · 🔍 Fetching title for ${videoId}…`);
  let title = videoId;
  try {
    const infoJson = await ytdlp([
      "--dump-json",
      "--skip-download",
      ...commonYoutubeArgs(),
      cleanUrl,
    ], { signal, timeoutMs: YOUTUBE_METADATA_TIMEOUT_MS });
    const info = JSON.parse(infoJson.split(/\r?\n/).find(Boolean) ?? "{}") as { title?: string };
    if (info.title) title = info.title;
    onProgress?.(`⬇ ${title}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onProgress?.(`⚠ Title probe failed (${msg.slice(0, 80)}) — downloading anyway`);
  }

  const filename = safeFilename(title);
  const stagedPath = path.join(outputDir, `${videoId}.mp3`);
  const filePath = path.join(outputDir, `${filename}.mp3`);
  await fs.rm(stagedPath, { force: true });
  if (filePath !== stagedPath) await fs.rm(filePath, { force: true });

  const outputTemplate = path.join(outputDir, `${videoId}.%(ext)s`);
  const downloadArgs = [
    "-f", "bestaudio/best",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", DEFAULT_MP3_AUDIO_QUALITY,
    "--retry-sleep", "3",
    "--extractor-retries", "3",
    "--add-metadata",
    "--newline",
    ...commonYoutubeArgs(),
    "-o", outputTemplate,
    cleanUrl,
  ];
  onProgress?.(`⬇ Downloading audio…`);
  try {
    await ytdlpProgress(downloadArgs, onProgress, { signal });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Timeout/403 usually means the current player client is blocked by
    // YouTube. Switching client (and retrying with a shorter budget) is far
    // more likely to succeed than just adding cookies.
    onProgress?.(`⚠ yt-dlp failed (${msg.slice(0, 80)}) — retrying with alternate client…`);
    const altArgs = downloadArgs.map((a) =>
      a === `youtube:player_client=${YOUTUBE_MP3_PLAYER_CLIENTS}`
        ? "youtube:player_client=android,ios,mweb"
        : a,
    );
    await ytdlpProgress(altArgs, onProgress, { signal, timeoutMs: Math.min(ytDlpDownloadTimeoutMs(), 60_000) });
  }

  if (!existsSync(stagedPath)) {
    throw new Error(`yt-dlp finished but ${videoId}.mp3 was not created`);
  }
  if (filePath !== stagedPath) {
    await fs.rm(filePath, { force: true });
    await fs.rename(stagedPath, filePath);
  }

  const stat = await fs.stat(filePath);
  onProgress?.(`✅ ${filename} · ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  return { filePath, title, size: stat.size };
}

export async function youtubePlaylistToMp3(
  playlistUrl: string,
  outputDir: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<YoutubePlaylistMp3Result> {
  await fs.mkdir(outputDir, { recursive: true });
  if (signal?.aborted) throw new Error("ABORTED");

  onProgress?.("🔍 Fetching playlist info…");
  const flatJson = await ytdlp([
    "--flat-playlist",
    "--dump-json",
    "--skip-download",
    ...commonYoutubeArgs(),
    playlistUrl,
  ], { signal, timeoutMs: 60_000 });

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
      const prefix = `[${idx}/${entries.length}] `;
      const result = await youtubeToMp3(videoUrl, outputDir, (msg) => onProgress?.(`${prefix}${msg}`), signal);
      items.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ title: label, error: msg });
      onProgress?.(`[${idx}/${entries.length}] ❌ ${label} — ${msg}`);
    }

    if (idx < entries.length && !signal?.aborted) {
      const delayMs = playlistTrackDelayMs();
      onProgress?.(`⏳ ${Math.round(delayMs / 1000)}s pause before next track…`);
      await sleep(delayMs);
    }
  }

  onProgress?.(`✅ ${items.length}/${entries.length} done`);
  if (errors.length > 0) {
    onProgress?.(`❌ ${errors.length} failed: ${errors.map(e => e.title).join(", ")}`);
  }

  return { items, errors };
}
