#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import TelegramBot from "node-telegram-bot-api";
import { JobManager, formatDuration, type ActiveOperation } from "./job-manager.js";
import { initWorkspace } from "../cli/src/core/workspace.js";
import { ingestFile, ingestFolder, ingestUrl, processInbox } from "../cli/src/core/ingest.js";
import { resolveWorkspace } from "../cli/src/core/paths.js";
import { getWorkspaceStatus } from "../cli/src/core/status.js";
import { searchWorkspace } from "../cli/src/search/search.js";
import { askLocal } from "../cli/src/search/ask.js";
import { runHealthCheck } from "../cli/src/health/checker.js";
import { renderPortal } from "../cli/src/portal/render.js";
import { updateWikiIndexes } from "../cli/src/wiki/indexes.js";
import { exportMemoryCards } from "../cli/src/memory/export.js";
import { writeDailyLog } from "../cli/src/wiki/daily-log.js";
import { exportAndRetainInHindsight, type HindsightIngestResult } from "../cli/src/core/hindsight.js";
import { isAudioOrVideoPath, transcribeMediaToMarkdown } from "../cli/src/core/media-transcription.js";
import {
  webscrapeFetch, webscrapeDetect, webscrapeHealth, webscrapeStats,
  webscrapeCrawlStart, webscrapeCrawlPause, webscrapeCrawlResume,
  webscrapeCrawlCancel, webscrapeCrawlStatus, webscrapeCrawlList,
} from "../cli/src/core/webscrape.js";
import {
  youtubeToMp3, youtubePlaylistToMp3,
  isYoutubeUrl, isYoutubePlaylistUrl,
  type YoutubeMp3Result, type YoutubePlaylistMp3Result,
} from "../cli/src/converters/youtube-mp3.js";

const token = process.env.BOT_key ?? process.env.BOT_KEY ?? process.env.TELEGRAM_BOT_TOKEN;
const workspace = resolveWorkspace(process.env.ASSIMILATOR_WORKSPACE ?? "knowledge-system");
const tempRoot = path.resolve(".tmp", "telegram");

if (!token) {
  console.error("Missing Telegram bot token. Set BOT_key, BOT_KEY, or TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

await initWorkspace(workspace);
await fsp.mkdir(tempRoot, { recursive: true });

// ── Action logging ────────────────────────────────────────────────────
const ACTION_LOG = path.join(workspace, "logs", "actions.jsonl");
const HINDSIGHT_KB = path.join(os.homedir(), ".hindsight", "memory-imports", "knowledgebase", "assimilator");

await fsp.mkdir(path.dirname(ACTION_LOG), { recursive: true });
await fsp.mkdir(HINDSIGHT_KB, { recursive: true });

interface ActionLogEntry {
  ts: string;
  action: string;
  source: string;
  result?: string;
  status: "started" | "completed" | "failed";
  error?: string;
  file?: string;
  size?: number;
}

function logAction(entry: ActionLogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(ACTION_LOG, line);
}

async function retainInHindsight(filePath: string, metadata: { id?: string; title?: string; sourceType?: string }): Promise<HindsightIngestResult | null> {
  try {
    const result = await exportAndRetainInHindsight(filePath, {
      sourceId: metadata.id,
      title: metadata.title,
      sourceType: metadata.sourceType,
    });
    logAction({
      ts: new Date().toISOString(),
      action: "hindsight_retain",
      source: filePath,
      result: result.exportPath,
      status: result.ok ? "completed" : "failed",
      error: result.error,
    });
    return result;
  } catch (err) {
    logAction({
      ts: new Date().toISOString(),
      action: "hindsight_retain",
      source: filePath,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const bot = new TelegramBot(token, {
  polling: {
    params: {
      timeout: 60,   // Telegram long-poll timeout (seconds)
    },
    interval: 500,
  },
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    },
    url: "https://api.telegram.org"
  }
});

// ── Active operation tracking (for /stop) ──────────────────────────
// JobManager lives in ./job-manager.ts (imported above) — pure, testable.
const jobManager = new JobManager();

async function cleanupOperation(op: ActiveOperation, chatId: number): Promise<string[]> {
  const deleted: string[] = [];
  const since = op.startedAt - 5000; // 5s margin

  for (const dir of op.outputDirs) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = path.join(dir, entry.name);
        try {
          const stat = await fsp.stat(fullPath);
          if (stat.mtimeMs >= since) {
            await fsp.unlink(fullPath);
            deleted.push(`${path.basename(dir)}/${entry.name}`);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // dir might not exist
    }
  }

  // Also clean .tmp partial downloads for this chat
  const chatTemp = path.join(tempRoot, String(chatId));
  try {
    const tmpEntries = await fsp.readdir(chatTemp, { withFileTypes: true });
    for (const entry of tmpEntries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(chatTemp, entry.name);
      try {
        const stat = await fsp.stat(fullPath);
        if (stat.mtimeMs >= since) {
          await fsp.unlink(fullPath);
          deleted.push(`tmp:${entry.name}`);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // dir might not exist
  }

  return deleted;
}

/**
 * Wraps an async operation so it can be stopped via /stop.
 * Tracks the operation, catches ABORTED gracefully, and cleans up on completion.
 */
async function runTracked<T>(
  chatId: number,
  description: string,
  outputDirs: string[],
  action: (signal: AbortSignal, onProgress?: (msg: string) => void) => Promise<T>,
): Promise<T | undefined> {
  let result: T | undefined;
  let opError: unknown;

  const op = jobManager.submit(chatId, description, outputDirs, async (signal, onProgress) => {
    try {
      result = await action(signal, onProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ABORTED") {
        await bot.sendMessage(chatId, `🛑 Aborted: ${description}`).catch(() => undefined);
      } else {
        opError = err;
      }
    }
  });

  await jobManager.awaitCompletion(op);
  if (opError !== undefined) throw opError;
  return result;
}
await registerCommands();

console.log(`ASSIMILATOR Telegram bot is listening. Workspace: ${workspace}`);

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

bot.on("error", (error) => {
  console.error("Telegram bot error:", error.message);
});

bot.onText(/^\/start\b/, async (message) => {
  await bot.sendMessage(message.chat.id, helpText(), { parse_mode: "Markdown" });
});

bot.onText(/^\/help\b/, async (message) => {
  await bot.sendMessage(message.chat.id, helpText(), { parse_mode: "Markdown" });
});

bot.onText(/^\/stop(?:\s+(\d+))?\b/, async (message, match) => {
  const targetId = match?.[1] ? Number.parseInt(match[1], 10) : undefined;

  const active = jobManager.activeList();
  if (active.length === 0) {
    await bot.sendMessage(message.chat.id, "No operation running.");
    return;
  }

  // /stop <id> — abort one specific job
  if (targetId !== undefined) {
    const op = jobManager.abort(targetId);
    if (!op) {
      await bot.sendMessage(message.chat.id, `No active job #${targetId}. Active: ${active.map(o => `#${o.id}`).join(", ") || "none"}`);
      return;
    }
    await bot.sendMessage(message.chat.id, `🛑 Aborting job #${op.id}: ${op.description}...`);
    const deleted = await cleanupOperation(op, message.chat.id);
    const lines = [`✅ *Stopped*: ${op.description}`];
    if (deleted.length > 0) {
      lines.push(`🧹 Cleaned ${deleted.length} file(s):`);
      lines.push(deleted.slice(0, 20).map(f => `  • ${f}`).join("\n"));
      if (deleted.length > 20) lines.push(`  ...and ${deleted.length - 20} more`);
    }
    await bot.sendMessage(message.chat.id, lines.join("\n"), { parse_mode: "Markdown" }).catch(() => undefined);
    return;
  }

  // /stop — abort ALL running + queued jobs
  const aborted = jobManager.abortAll();
  const descriptions = aborted.map(o => `#${o.id} ${o.description}`).join("\n  ");
  await bot.sendMessage(message.chat.id, `🛑 Aborting ${aborted.length} job(s):\n  ${descriptions}`);
  for (const op of aborted) {
    try {
      const deleted = await cleanupOperation(op, message.chat.id);
      if (deleted.length > 0) {
        await bot.sendMessage(message.chat.id, `🧹 #${op.id}: cleaned ${deleted.length} file(s)`).catch(() => undefined);
      }
    } catch {
      // cleanup best-effort
    }
  }
});

bot.onText(/^\/commands\b/, async (message) => {
  await bot.sendMessage(message.chat.id, commandText(), { parse_mode: "Markdown" });
});

bot.onText(/^\/convert_url(?:\s+([\s\S]+))?/, async (message, match) => {
  const url = match?.[1]?.trim();
  if (!url) {
    await bot.sendMessage(message.chat.id, "Send `/convert_url https://example.com/article`.", { parse_mode: "Markdown" });
    return;
  }
  await convertUrlForChat(message.chat.id, url);
});

bot.onText(/^\/convert_file\b/, async (message) => {
  await bot.sendMessage(message.chat.id, "Upload a document, PDF, EPUB, HTML, Markdown, text, image, audio file, or other supported file. I will convert it and send back Markdown + HTML.");
});

bot.onText(/^\/status\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const status = await getWorkspaceStatus(workspace);
    const counts = Object.entries(status.counts).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    const jobLines = jobManager.statusLines();
    await bot.sendMessage(message.chat.id, [
      ...jobLines,
      "",
      `Workspace: ${workspace}`,
      `Initialized: ${status.initialized ? "yes" : "no"}`,
      counts,
    ].join("\n"), { parse_mode: "Markdown" });
  });
});

bot.onText(/^\/search(?:\s+([\s\S]+))?/, async (message, match) => {
  const query = match?.[1]?.trim();
  if (!query) {
    await bot.sendMessage(message.chat.id, "Send `/search your query`.", { parse_mode: "Markdown" });
    return;
  }
  await withChatError(message.chat.id, async () => {
    const matches = await searchWorkspace(workspace, query);
    const body = matches.length
      ? matches.slice(0, 10).map((item) => `${item.file}:${item.line}: ${item.text}`).join("\n")
      : "No matches.";
    await bot.sendMessage(message.chat.id, truncateForTelegram(body));
  });
});

bot.onText(/^\/ask(?:\s+([\s\S]+))?/, async (message, match) => {
  const query = match?.[1]?.trim();
  if (!query) {
    await bot.sendMessage(message.chat.id, "Send `/ask what did I save about markdown?`.", { parse_mode: "Markdown" });
    return;
  }
  await withChatError(message.chat.id, async () => {
    const result = await askLocal(workspace, query);
    await bot.sendMessage(message.chat.id, truncateForTelegram(result.answer));
  });
});

bot.onText(/^\/health\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const status = await bot.sendMessage(message.chat.id, "Running health check...");
    const result = await runHealthCheck(workspace);
    await bot.editMessageText(`Health check complete.\nIssues: ${result.issues.length}\nMarkdown: ${result.markdownPath}\nJSON: ${result.jsonPath}`, {
      chat_id: message.chat.id,
      message_id: status.message_id
    });
    await sendExistingDocument(message.chat.id, result.markdownPath);
    await sendExistingDocument(message.chat.id, result.jsonPath);
  });
});

bot.onText(/^\/render_portal\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const result = await renderPortal(workspace);
    await bot.sendMessage(message.chat.id, `Portal rendered.\nPages: ${result.pagesRendered}\nIndex: ${result.indexPath}`);
  });
});

bot.onText(/^\/compile_wiki\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    await updateWikiIndexes(workspace);
    await bot.sendMessage(message.chat.id, "Wiki indexes refreshed.");
  });
});

bot.onText(/^\/process_inbox\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const results = await processInbox(workspace);
    // Also process Hindsight incoming directory
    const hindsightDir = path.join(os.homedir(), ".hindsight", "memory-imports", "incoming");
    let hindsightCount = 0;
    if (fs.existsSync(hindsightDir)) {
      const files = await fsp.readdir(hindsightDir);
      const mdFiles = files.filter(f => f.endsWith(".md"));
      for (const file of mdFiles) {
        const filePath = path.join(hindsightDir, file);
        try {
          await ingestFile(workspace, filePath, { tags: ["hindsight-incoming"] });
          await fsp.unlink(filePath); // Clean up after ingest
          hindsightCount++;
        } catch (err) {
          console.error(`Failed to ingest ${filePath}:`, err instanceof Error ? err.message : String(err));
        }
      }
    }
    const total = results.length + hindsightCount;
    await bot.sendMessage(message.chat.id, [
      `Inbox items processed: ${total}`,
      results.length ? `  Assimilator inbox: ${results.length}` : "",
      hindsightCount ? `  Hindsight incoming: ${hindsightCount}` : "",
    ].filter(Boolean).join("\n"));
  });
});

bot.onText(/^\/log\b/, async (message) => {
  try {
    if (!fs.existsSync(ACTION_LOG)) {
      await bot.sendMessage(message.chat.id, "No actions logged yet.");
      return;
    }
    const raw = fs.readFileSync(ACTION_LOG, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const last = lines.slice(-15);
    const entries = last.map((l) => {
      const e: ActionLogEntry = JSON.parse(l);
      const statusIcon = e.status === "completed" ? "✅" : e.status === "failed" ? "❌" : "⏳";
      const sizeStr = e.size ? ` ${(e.size / 1024).toFixed(1)}KB` : "";
      const time = e.ts.slice(11, 19);
      return `${statusIcon} \`${time}\` ${e.action} → ${(e.result || e.source).slice(0, 50)}${sizeStr}`;
    }).join("\n");

    await bot.sendMessage(message.chat.id, [
      `📋 *Last ${last.length} actions:*`,
      entries,
      `\\_${lines.length} total entries\\_`,
    ].join("\n\n"), { parse_mode: "Markdown" });
  } catch (err) {
    await bot.sendMessage(message.chat.id, `❌ Failed to read log: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.onText(/^\/ingest(?:\s+([\s\S]+))?/, async (message, match) => {
  const filePath = match?.[1]?.trim();
  if (!filePath) {
    await bot.sendMessage(message.chat.id, "Send `/ingest /path/to/file.md` or `/ingest /path/to/folder/` to ingest files.", { parse_mode: "Markdown" });
    return;
  }
  await withChatError(message.chat.id, async () => {
    const resolved = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : path.resolve(filePath);
    const stat = await fsp.stat(resolved);
    if (stat.isDirectory()) {
      const results = await ingestFolder(workspace, resolved);
      let retained = 0;
      for (const result of results) {
        const hindsight = await retainInHindsight(result.processedMarkdownPath, {
          id: result.metadata.id,
          title: result.metadata.title,
          sourceType: result.metadata.source_type,
        });
        if (hindsight?.ok) retained++;
      }
      await bot.sendMessage(message.chat.id, `📥 Ingested ${results.length} files from folder: ${resolved}\n🧠 Hindsight retained: ${retained}/${results.length}`);
      for (const r of results) {
        if (r.processedMarkdownPath && fs.existsSync(r.processedMarkdownPath)) {
          await sendExistingDocument(message.chat.id, r.processedMarkdownPath);
        }
      }
    } else {
      const result = await ingestFile(workspace, resolved);
      const hindsight = await retainInHindsight(result.processedMarkdownPath, {
        id: result.metadata.id,
        title: result.metadata.title,
        sourceType: result.metadata.source_type,
      });
      await bot.sendMessage(message.chat.id, [
        `📥 Ingested: ${result.metadata.title}`,
        `Markdown: ${result.processedMarkdownPath}`,
        `Wiki: ${result.wikiPath}`,
        hindsight?.ok ? `Hindsight: retained` : `Hindsight: queued/failed — check /log`,
      ].join("\n"));
      if (fs.existsSync(result.processedMarkdownPath)) {
        await sendExistingDocument(message.chat.id, result.processedMarkdownPath);
      }
    }
  });
});

bot.onText(/^\/memory_export\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const result = await exportMemoryCards(workspace);
    await bot.sendMessage(message.chat.id, `Memory cards exported: ${result.cards.length}\n${result.jsonlPath}`);
    await sendExistingDocument(message.chat.id, result.jsonlPath);
  });
});

bot.onText(/^\/daily_log(?:\s+([\s\S]+))?/, async (message, match) => {
  await withChatError(message.chat.id, async () => {
    const note = match?.[1]?.trim();
    const result = await writeDailyLog(workspace, { note });
    await bot.sendMessage(message.chat.id, `${result.created ? "Created" : "Updated"} daily log:\n${result.path}`);
    await sendExistingDocument(message.chat.id, result.path);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Webscraping commands
// ═══════════════════════════════════════════════════════════════════════

bot.onText(/^\/scrape_fetch(?:\s+([\s\S]+))?/, async (message, match) => {
  const url = match?.[1]?.trim();
  if (!url) {
    await bot.sendMessage(message.chat.id, "Send `/scrape_fetch https://example.com` to fetch through the multi-tier chain.", { parse_mode: "Markdown" });
    return;
  }
  await withChatError(message.chat.id, async () => {
    const status = await bot.sendMessage(message.chat.id, `🔄 Fetching ${url} through tier chain...`);
    const result = await webscrapeFetch(url);
    if (result.success) {
      await bot.editMessageText([
        `✅ *Fetched successfully*`,
        `Tier: \`${result.tier}\``,
        `Status: ${result.status}`,
        `Time: ${result.elapsedMs}ms`,
        `Size: ${result.bodyLength} bytes`,
        result.title ? `Title: ${result.title}` : "",
        result.protection ? `Protection: ${result.protection}` : "",
      ].filter(Boolean).join("\n"), {
        chat_id: message.chat.id,
        message_id: status.message_id,
        parse_mode: "Markdown",
      });
    } else {
      await bot.editMessageText(`❌ Failed: ${result.error}`, {
        chat_id: message.chat.id,
        message_id: status.message_id,
      });
    }
  });
});

bot.onText(/^\/scrape_detect(?:\s+([\s\S]+))?/, async (message, match) => {
  const url = match?.[1]?.trim();
  if (!url) {
    await bot.sendMessage(message.chat.id, "Send `/scrape_detect https://example.com` to check anti-bot protection.", { parse_mode: "Markdown" });
    return;
  }
  await withChatError(message.chat.id, async () => {
    const status = await bot.sendMessage(message.chat.id, `🔍 Scanning ${url}...`);
    const result = await webscrapeDetect(url);
    await bot.editMessageText(
      result.detected
        ? `🛡️ *${result.type}* (${result.confidence})\nStatus: ${result.status}`
        : `✅ No protection detected\nStatus: ${result.status}`,
      { chat_id: message.chat.id, message_id: status.message_id, parse_mode: "Markdown" },
    );
  });
});

bot.onText(/^\/scrape_health\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const result = await webscrapeHealth();
    await bot.sendMessage(message.chat.id, result.healthy ? `✅ ${result.message}` : `❌ ${result.message}`);
  });
});

bot.onText(/^\/scrape_stats\b/, async (message) => {
  await withChatError(message.chat.id, async () => {
    const stats = webscrapeStats();
    const lines = [`🛡️ *Protection events: ${stats.totalEvents}*`];
    if (stats.totalEvents > 0) {
      lines.push("\n*By type:*");
      for (const [type, info] of Object.entries(stats.summary)) {
        lines.push(`  \`${type}\`: ${info.count}x (${info.tiers.join(", ")})`);
      }
    } else {
      lines.push("\nNo protection events recorded yet.");
    }
    await bot.sendMessage(message.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
  });
});

bot.onText(/^\/scrape_crawl(?:\s+([\s\S]+))?/, async (message, match) => {
  const args = match?.[1]?.trim().split(/\s+/) ?? [];
  const subcmd = args[0]?.toLowerCase();
  const arg1 = args[1];
  const arg2 = args[2];

  if (!subcmd || subcmd === "help") {
    await bot.sendMessage(message.chat.id, [
      "🕷️ *Webscrape Crawl*",
      "",
      "`/scrape_crawl start <url> [depth] [pages]` — start",
      "`/scrape_crawl pause <id>` — pause",
      "`/scrape_crawl resume <id>` — resume",
      "`/scrape_crawl cancel <id>` — cancel",
      "`/scrape_crawl status <id>` — show stats",
      "`/scrape_crawl list` — list all",
    ].join("\n"), { parse_mode: "Markdown" });
    return;
  }

  await withChatError(message.chat.id, async () => {
    if (subcmd === "start") {
      if (!arg1) { await bot.sendMessage(message.chat.id, "Usage: `/scrape_crawl start <url> [depth] [pages]`", { parse_mode: "Markdown" }); return; }
      const result = await webscrapeCrawlStart([arg1], {
        maxDepth: arg2 ? parseInt(arg2, 10) : 2,
        maxPages: args[3] ? parseInt(args[3], 10) : 50,
      });
      await bot.sendMessage(message.chat.id, `🕷️ ${result.message}`, { parse_mode: "Markdown" });
    } else if (subcmd === "pause") {
      if (!arg1) { await bot.sendMessage(message.chat.id, "Usage: `/scrape_crawl pause <id>`", { parse_mode: "Markdown" }); return; }
      await bot.sendMessage(message.chat.id, await webscrapeCrawlPause(arg1));
    } else if (subcmd === "resume") {
      if (!arg1) { await bot.sendMessage(message.chat.id, "Usage: `/scrape_crawl resume <id>`", { parse_mode: "Markdown" }); return; }
      await bot.sendMessage(message.chat.id, await webscrapeCrawlResume(arg1));
    } else if (subcmd === "cancel") {
      if (!arg1) { await bot.sendMessage(message.chat.id, "Usage: `/scrape_crawl cancel <id>`", { parse_mode: "Markdown" }); return; }
      await bot.sendMessage(message.chat.id, await webscrapeCrawlCancel(arg1));
    } else if (subcmd === "status") {
      if (!arg1) { await bot.sendMessage(message.chat.id, "Usage: `/scrape_crawl status <id>`", { parse_mode: "Markdown" }); return; }
      const state = await webscrapeCrawlStatus(arg1);
      if (!state) { await bot.sendMessage(message.chat.id, `Crawl ${arg1} not found`); return; }
      await bot.sendMessage(message.chat.id, [
        `🕷️ *${state.id.slice(0, 8)}* — ${state.status}`,
        `Pages: ${state.stats.pagesCrawled} crawled / ${state.stats.pagesFailed} failed`,
        `Queued: ${state.queue.length}`,
        `Bytes: ${state.stats.bytesDownloaded}`,
        state.error ? `Error: ${state.error}` : "",
      ].filter(Boolean).join("\n"), { parse_mode: "Markdown" });
    } else if (subcmd === "list") {
      const crawls = await webscrapeCrawlList();
      if (crawls.length === 0) {
        await bot.sendMessage(message.chat.id, "No crawls active.");
        return;
      }
      const lines = crawls.map(c => `🕷️ \`${c.id.slice(0, 8)}\`  ${c.status}  ${c.stats.pagesCrawled}p`);
      await bot.sendMessage(message.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(message.chat.id, `Unknown subcommand: ${subcmd}\nSend \`/scrape_crawl help\``, { parse_mode: "Markdown" });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// YouTube → MP3 commands
// ═══════════════════════════════════════════════════════════════════════

const mp3OutputDir = path.join(os.homedir(), "apps", "assimilator", "results", "mp3");
const TELEGRAM_AUDIO_LIMIT_BYTES = Number(process.env.ASSIMILATOR_TELEGRAM_AUDIO_LIMIT_MB ?? 48) * 1024 * 1024;

/** Parse --setArtist "Name" or --setArtist Name from command text. Returns artist name or null. */
function parseArtistFlag(text: string): { artist: string | null; rest: string } {
  // Accepts: --setArtist "Name", --author "Name", -author "Name",
  // and the em-dash variant —author "Name" (U+2014), which users type on mac/ru keyboards.
  // Quotes may be straight ("), curly (“”), or guillemets («»).
  const match = text.match(
    /(?:--?setArtist|--?author|—author|–author)\s+(?:"([^"]*)"|“([^”]*)”|«([^»]*)»|([^\s]+))/i,
  );
  if (match) {
    const artist = match[1] ?? match[2] ?? match[3] ?? match[4] ?? null;
    const rest = text.replace(match[0], "").trim();
    return { artist, rest };
  }
  return { artist: null, rest: text };
}

function errorToSearchableText(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message, error.stack ?? "");
  parts.push(String(error));
  try { parts.push(JSON.stringify(error)); } catch { /* ignore */ }
  const maybe = error as { response?: { statusCode?: unknown; body?: unknown } };
  if (maybe?.response) {
    parts.push(String(maybe.response.statusCode ?? ""));
    if (typeof maybe.response.body === "string") parts.push(maybe.response.body);
    else {
      try { parts.push(JSON.stringify(maybe.response.body)); } catch { /* ignore */ }
    }
  }
  return parts.filter(Boolean).join("\n");
}

function isTelegramTooLargeError(error: unknown): boolean {
  const message = errorToSearchableText(error);
  return message.includes("413")
    || /Request Entity Too Large/i.test(message)
    || /ENTITY_TOO_LARGE/i.test(message)
    || /payload too large/i.test(message);
}

async function execFilePromise(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { timeout: 10 * 60 * 1000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

async function makeTelegramSizedMp3(item: YoutubeMp3Result): Promise<YoutubeMp3Result> {
  if (item.size <= TELEGRAM_AUDIO_LIMIT_BYTES) return item;
  const parsed = path.parse(item.filePath);
  const compressedPath = path.join(parsed.dir, `${parsed.name}.telegram-64k${parsed.ext || ".mp3"}`);
  await execFilePromise("ffmpeg", [
    "-y", "-v", "error",
    "-i", item.filePath,
    "-vn",
    "-codec:a", "libmp3lame",
    "-b:a", "64k",
    compressedPath,
  ]);
  const stat = await fsp.stat(compressedPath);
  return { ...item, filePath: compressedPath, size: stat.size };
}

async function sendMp3ResultToTelegram(
  chatId: number,
  item: YoutubeMp3Result,
  performer: string,
): Promise<{ status: "sent" | "too-large"; item: YoutubeMp3Result }> {
  const sendItem = await makeTelegramSizedMp3(item).catch(() => item);
  if (sendItem.size > TELEGRAM_AUDIO_LIMIT_BYTES) {
    return { status: "too-large", item: sendItem };
  }
  try {
    await bot.sendAudio(chatId, fs.createReadStream(sendItem.filePath), {
      title: sendItem.title,
      performer,
    }, { filename: path.basename(sendItem.filePath), contentType: "audio/mpeg" });
    return { status: "sent", item: sendItem };
  } catch (error) {
    if (isTelegramTooLargeError(error)) return { status: "too-large", item: sendItem };
    throw error;
  }
}

function formatLocalMp3Notice(item: YoutubeMp3Result): string {
  return [
    `⚠️ MP3 is too large for Telegram upload.`,
    `📦 ${(item.size / 1024 / 1024).toFixed(1)} MB`,
    `📁 Saved locally:`,
    `\`${item.filePath}\``,
    ``,
    `For long videos I now default to lower-bitrate MP3 output (64K).`,
    `If this file was created before the fix, run the command again and it should be smaller.`,
  ].join("\n");
}

bot.onText(/^\/youtube_to_mp3(?:\s+([\s\S]+))?/, async (message, match) => {
  const raw = match?.[1]?.trim();
  if (!raw) {
    await bot.sendMessage(message.chat.id, "Send `/youtube_to_mp3 <url> [--author \"Name\"]`.\n\nSets the MP3's artist/performer tag. Aliases: `--author`, `--setArtist`, `—author` (em-dash).", { parse_mode: "Markdown" });
    return;
  }
  const { artist, rest } = parseArtistFlag(raw);
  const url = rest;
  if (!url || !isYoutubeUrl(url)) {
    await bot.sendMessage(message.chat.id, `❌ Not a YouTube URL: ${url}`);
    return;
  }

  const startTime = Date.now();
  logAction({ ts: new Date().toISOString(), action: "youtube_to_mp3", source: url, status: "started" });

  const performer = artist || "YouTube";
  const status = await bot.sendMessage(message.chat.id, `🎬 *YouTube → MP3*\\n🔍 Analyzing video...`, { parse_mode: "Markdown" });
  let lastUpdate = 0;

  await runTracked(message.chat.id, `YouTube → MP3: ${url.slice(0, 80)}`, [mp3OutputDir], async (signal, onProgress) => {
    const result = await youtubeToMp3(url, mp3OutputDir, (msg) => {
      onProgress?.(msg);
      const now = Date.now();
      if (now - lastUpdate > 1000) {
        lastUpdate = now;
        void bot.editMessageText(`🎵 ${msg}`, {
          chat_id: message.chat.id,
          message_id: status.message_id,
        }).catch(() => undefined);
      }
    }, signal);

    const duration = formatDuration(Date.now() - startTime);

    logAction({
      ts: new Date().toISOString(), action: "youtube_to_mp3", source: url,
      status: "completed", result: result.title,
      file: result.filePath, size: result.size,
    });

    const sendResult = await sendMp3ResultToTelegram(message.chat.id, result, performer);
    const deliveredItem = sendResult.item;

    await bot.editMessageText(
      sendResult.status === "sent"
        ? `✅ *${deliveredItem.title}*\\n📦 ${(deliveredItem.size / 1024 / 1024).toFixed(1)} MB\\n⏱ ${duration}`
        : `✅ *${deliveredItem.title}*\\n📦 ${(deliveredItem.size / 1024 / 1024).toFixed(1)} MB\\n⏱ ${duration}\\n\\n${formatLocalMp3Notice(deliveredItem)}`,
      { chat_id: message.chat.id, message_id: status.message_id, parse_mode: "Markdown" },
    );
  }).catch(async (err) => {
    const duration = formatDuration(Date.now() - startTime);
    const errorText = errorToSearchableText(err);
    logAction({ ts: new Date().toISOString(), action: "youtube_to_mp3", source: url, status: "failed", error: errorText });
    if (isTelegramTooLargeError(err)) {
      await bot.sendMessage(message.chat.id, [
        `⚠️ Converted, but Telegram rejected the upload as too large (${duration}).`,
        `The MP3 was saved locally in:`,
        `\`${mp3OutputDir}\``,
        ``,
        `I will not retry uploading the oversized file. Re-run now; the bot will auto-compress before sending.`,
      ].join("\n"), { parse_mode: "Markdown" }).catch(() => undefined);
    } else if (err instanceof Error && err.message !== "ABORTED") {
      await bot.sendMessage(message.chat.id, `❌ Failed (${duration}): ${truncateForTelegram(err.message)}`).catch(() => undefined);
    }
  });
});

bot.onText(/^\/youtube_playlist_to_mp3(?:\s+([\s\S]+))?/, async (message, match) => {
  const raw = match?.[1]?.trim();
  if (!raw) {
    await bot.sendMessage(message.chat.id, "Send `/youtube_playlist_to_mp3 <url> [--author \"Name\"]`.\n\nSets the MP3's artist/performer tag. Aliases: `--author`, `--setArtist`, `—author` (em-dash).", { parse_mode: "Markdown" });
    return;
  }
  const { artist, rest } = parseArtistFlag(raw);
  const url = rest;
  if (!url || !isYoutubePlaylistUrl(url)) {
    await bot.sendMessage(message.chat.id, `❌ Not a YouTube playlist URL: ${url}`);
    return;
  }

  const performer = artist || "YouTube";
  const status = await bot.sendMessage(message.chat.id, `🎵 Fetching playlist info...${artist ? `\nArtist: ${artist}` : ""}`);
  let lastUpdate = 0;

  const result = await runTracked(message.chat.id, `Playlist → MP3: ${url.slice(0, 80)}`, [mp3OutputDir], async (signal) => {
    return await youtubePlaylistToMp3(url, mp3OutputDir, (msg) => {
      const now = Date.now();
      if (now - lastUpdate > 1000) {
        lastUpdate = now;
        void bot.editMessageText(`🎵 ${msg}`, {
          chat_id: message.chat.id,
          message_id: status.message_id,
        }).catch(() => undefined);
      }
    }, signal);
  });

  if (!result) return;

  let sent = 0;
  let tooLarge = 0;
  const localOnly: YoutubeMp3Result[] = [];
  for (const item of result.items) {
    try {
      const sendResult = await sendMp3ResultToTelegram(message.chat.id, item, performer);
      if (sendResult.status === "sent") {
        sent++;
      } else {
        tooLarge++;
        localOnly.push(sendResult.item);
      }
    } catch (error) {
      result.errors.push({ title: item.title, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let summary = `✅ *Playlist complete*\n🎵 ${sent}/${result.items.length} sent`;
  if (tooLarge > 0) {
    summary += `\n⚠️ ${tooLarge} file(s) too large for Telegram; saved locally:`;
    summary += `\n` + localOnly.slice(0, 5).map(item => `  • ${item.title} — ${(item.size / 1024 / 1024).toFixed(1)} MB\n    \`${item.filePath}\``).join("\n");
    if (localOnly.length > 5) summary += `\n  ...and ${localOnly.length - 5} more`;
  }
  if (result.errors.length > 0) {
    summary += `\n❌ ${result.errors.length} failed:\n`;
    summary += result.errors.slice(0, 5).map(e => `  • ${e.title}: ${e.error}`).join("\n");
    if (result.errors.length > 5) summary += `\n  ...and ${result.errors.length - 5} more`;
  }
  await bot.editMessageText(summary, {
    chat_id: message.chat.id,
    message_id: status.message_id,
    parse_mode: "Markdown",
  });
});

bot.on("document", async (message) => {
  if (!message.document) return;
  const localPath = await downloadTelegramFile(message.chat.id, message.document.file_id, message.document.file_name ?? `${message.document.file_unique_id}.bin`);
  await ingestTelegramLocalFile(message.chat.id, localPath, "telegram-document");
});

bot.on("voice", async (message) => {
  if (!message.voice) return;
  const fileName = `${message.voice.file_unique_id}.ogg`;
  const localPath = await downloadTelegramFile(message.chat.id, message.voice.file_id, fileName);
  await ingestTelegramLocalFile(message.chat.id, localPath, "telegram-voice", { forceTranscribe: true });
});

bot.on("audio", async (message) => {
  if (!message.audio) return;
  const fileName = `${safeFileName(message.audio.title ?? message.audio.file_unique_id)}.mp3`;
  const localPath = await downloadTelegramFile(message.chat.id, message.audio.file_id, fileName);
  await ingestTelegramLocalFile(message.chat.id, localPath, "telegram-audio", { forceTranscribe: true });
});

bot.on("video", async (message) => {
  if (!message.video) return;
  const fileName = `${message.video.file_unique_id}.mp4`;
  const localPath = await downloadTelegramFile(message.chat.id, message.video.file_id, fileName);
  await ingestTelegramLocalFile(message.chat.id, localPath, "telegram-video", { forceTranscribe: true });
});

bot.on("photo", async (message) => {
  if (!message.photo?.length) return;
  const photo = message.photo[message.photo.length - 1];
  if (!photo) return;
  const localPath = await downloadTelegramFile(message.chat.id, photo.file_id, `${photo.file_unique_id}.jpg`);
  await ingestTelegramLocalFile(message.chat.id, localPath, "telegram-photo");
});

bot.on("message", async (message) => {
  if (!message.text || message.text.startsWith("/") || message.document) return;
  const url = findFirstUrl(message.text);
  if (url) {
    await convertUrlForChat(message.chat.id, url);
  }
});

async function convertUrlForChat(chatId: number, url: string): Promise<void> {
  const startTime = Date.now();
  logAction({ ts: new Date().toISOString(), action: "convert_url", source: url, status: "started" });

  const processedDir = path.join(workspace, "processed");
  await runTracked(chatId, `Convert URL: ${url.slice(0, 80)}`, [processedDir, tempRoot], async (signal, onProgress) => {
    if (signal.aborted) throw new Error("ABORTED");

    const progress = await bot.sendMessage(chatId, `⏳ Converting URL...\n${url.slice(0, 100)}`);
    const startMsgId = progress.message_id;

    // Progress heartbeat: update elapsed time + phase every 3 seconds
    const heartbeat = setInterval(() => {
      onProgress?.(`Converting... (${formatDuration(Date.now() - startTime)})`);
      void bot.editMessageText(`⏳ Converting... (${formatDuration(Date.now() - startTime)})\nFetching page content…`, {
        chat_id: chatId, message_id: startMsgId,
      }).catch(() => undefined);
    }, 3000);

    onProgress?.("Fetching page content…");
    const result = await ingestUrl(workspace, url, { tags: ["telegram-bot"] });
    clearInterval(heartbeat);
    if (signal.aborted) throw new Error("ABORTED");

    const title = result.metadata.title;
    const duration = formatDuration(Date.now() - startTime);

    onProgress?.("Extracted → running wiki index…");
    await bot.editMessageText(`📝 Extracted → running wiki index…`, {
      chat_id: chatId, message_id: startMsgId,
    });
    updateWikiIndexes(workspace).catch(() => undefined);

    onProgress?.("Retaining in Hindsight…");
    const hindsight = await retainInHindsight(result.processedMarkdownPath, {
      id: result.metadata.id,
      title: result.metadata.title,
      sourceType: result.metadata.source_type,
    });

    const fileSize = fs.statSync(result.processedMarkdownPath).size;

    logAction({
      ts: new Date().toISOString(), action: "convert_url", source: url,
      status: "completed", result: title,
      file: result.processedMarkdownPath, size: fileSize,
    });

    const lines = [
      `✅ *Ingest complete* (${duration})`,
      `📄 Title: ${title}`,
      `📦 ${(fileSize / 1024).toFixed(1)} KB`,
      hindsight?.ok ? `🧠 Hindsight ingest: ✓` : "🧠 Hindsight ingest: queued/failed — check /log",
    ].filter(Boolean);

    await bot.editMessageText(lines.join("\n"), {
      chat_id: chatId, message_id: startMsgId, parse_mode: "Markdown",
    });

    if (result.processedMarkdownPath) await sendExistingDocument(chatId, result.processedMarkdownPath);
    const metadataPath = path.join(workspace, "processed", "metadata", `${result.metadata.id}.json`);
    if (fs.existsSync(metadataPath)) await sendExistingDocument(chatId, metadataPath);
  }).catch(async (err) => {
    const duration = formatDuration(Date.now() - startTime);
    logAction({ ts: new Date().toISOString(), action: "convert_url", source: url, status: "failed", error: err instanceof Error ? err.message : String(err) });
    if (err instanceof Error && err.message !== "ABORTED") {
      await bot.sendMessage(chatId, `❌ Conversion failed (${duration}): ${err.message}`).catch(() => undefined);
    }
  });
}

async function downloadTelegramFile(chatId: number, fileId: string, fileName: string): Promise<string> {
  const safeName = safeFileName(fileName);
  const chatDir = path.join(tempRoot, String(chatId));
  await fsp.mkdir(chatDir, { recursive: true });
  const localPath = path.join(chatDir, safeName);
  const link = await bot.getFileLink(fileId);
  const response = await fetch(link);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(localPath, bytes);
  return localPath;
}

async function ingestTelegramLocalFile(
  chatId: number,
  localPath: string,
  sourceLabel: string,
  options: { forceTranscribe?: boolean } = {},
): Promise<void> {
  const startTime = Date.now();
  const progress = await bot.sendMessage(chatId, `📥 Downloaded ${path.basename(localPath)}. Ingesting...`);
  await runTracked(chatId, `Ingest ${sourceLabel}: ${path.basename(localPath)}`, [tempRoot, workspace], async (signal) => {
    if (signal.aborted) throw new Error("ABORTED");
    let ingestPath = localPath;
    if (options.forceTranscribe || isAudioOrVideoPath(localPath)) {
      await bot.editMessageText(`🎙️ Transcribing ${path.basename(localPath)} locally...`, {
        chat_id: chatId,
        message_id: progress.message_id,
      });
      ingestPath = await transcribeMediaToMarkdown(localPath, path.join(tempRoot, String(chatId), "transcripts"), {
        title: path.basename(localPath, path.extname(localPath)),
        sourceLabel,
      });
    }

    await bot.editMessageText(`🧩 Writing ASSIMILATOR source/wiki artifacts...`, {
      chat_id: chatId,
      message_id: progress.message_id,
    });
    const result = await ingestFile(workspace, ingestPath, { tags: [sourceLabel, "telegram-bot"] });
    if (signal.aborted) throw new Error("ABORTED");
    const hindsight = await retainInHindsight(result.processedMarkdownPath, {
      id: result.metadata.id,
      title: result.metadata.title,
      sourceType: result.metadata.source_type,
    });
    const fileSize = fs.statSync(result.processedMarkdownPath).size;
    const duration = formatDuration(Date.now() - startTime);
    logAction({
      ts: new Date().toISOString(),
      action: "ingest_media",
      source: localPath,
      result: result.processedMarkdownPath,
      status: "completed",
      file: result.processedMarkdownPath,
      size: fileSize,
    });
    await bot.editMessageText([
      `✅ *Ingest complete* (${duration})`,
      `📄 Title: ${result.metadata.title}`,
      `📦 ${(fileSize / 1024).toFixed(1)} KB`,
      hindsight?.ok ? `🧠 Hindsight ingest: ✓` : "🧠 Hindsight ingest: queued/failed — check /log",
    ].join("\n"), { chat_id: chatId, message_id: progress.message_id, parse_mode: "Markdown" });
    await sendExistingDocument(chatId, result.processedMarkdownPath);
    const metadataPath = path.join(workspace, "processed", "metadata", `${result.metadata.id}.json`);
    if (fs.existsSync(metadataPath)) await sendExistingDocument(chatId, metadataPath);
  }).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    logAction({ ts: new Date().toISOString(), action: "ingest_media", source: localPath, status: "failed", error: message });
    if (message !== "ABORTED") {
      await bot.sendMessage(chatId, `❌ Ingest failed: ${truncateForTelegram(message)}`).catch(() => undefined);
    }
  });
}

async function sendExistingDocument(chatId: number, filePath: string): Promise<void> {
  try {
    await bot.sendDocument(chatId, fs.createReadStream(filePath), {}, {
      filename: path.basename(filePath)
    });
  } catch (error) {
    if (isTelegramTooLargeError(error) || (errorToSearchableText(error).includes("file is too big"))) {
      const sizeMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(1);
      await bot.sendMessage(
        chatId,
        `⚠️ File too large for Telegram (${sizeMb} MB > 50 MB limit):\n${path.basename(filePath)}\nIt's still saved locally in the workspace.`
      ).catch(() => undefined);
      return;
    }
    throw error;
  }
}

async function withChatError(chatId: number, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await bot.sendMessage(chatId, `ASSIMILATOR error:\n${truncateForTelegram(message)}`);
  }
}

function findFirstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/)?.[0];
}

function safeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^\w.\- ()[\]]+/g, "_");
}

function truncateForTelegram(text: string): string {
  return text.length > 3900 ? `${text.slice(0, 3900)}\n...` : text;
}

async function registerCommands(): Promise<void> {
  const commands = [
    { command: "start", description: "Show ASSIMILATOR bot overview" },
    { command: "help", description: "Show available commands" },
    { command: "convert_url", description: "Convert a URL or YouTube link" },
    { command: "convert_file", description: "Upload a file for conversion" },
    { command: "status", description: "Show workspace status" },
    { command: "search", description: "Search local Markdown and wiki" },
    { command: "ask", description: "Ask against local evidence" },
    { command: "health", description: "Run a workspace health check" },
    { command: "render_portal", description: "Render the local HTML portal" },
    { command: "compile_wiki", description: "Refresh wiki indexes" },
    { command: "process_inbox", description: "Process workspace + Hindsight inbox files" },
    { command: "ingest", description: "Ingest a file or folder: /ingest /path/to/file.md" },
    { command: "memory_export", description: "Export memory cards" },
    { command: "daily_log", description: "Create or update today's daily log" },
    { command: "immortal_mode", description: "Bot auto-restart watchdog" },
    { command: "commands", description: "List command examples" },
    { command: "scrape_fetch", description: "Fetch URL through tier chain" },
    { command: "scrape_detect", description: "Check anti-bot protection" },
    { command: "scrape_crawl", description: "Start/pause/resume a crawl" },
    { command: "scrape_health", description: "Check Scrapling bridge" },
    { command: "scrape_stats", description: "Protection event stats" },
    { command: "youtube_to_mp3", description: "Convert YouTube video to MP3" },
    { command: "youtube_playlist_to_mp3", description: "Convert YouTube playlist to MP3" },
    { command: "stop", description: "Kill running operation + clean residual files" },
  ];

  try {
    await bot.setMyCommands(commands);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to register Telegram bot commands: ${message}`);
  }
}

function helpText(): string {
  return [
    "*ASSIMILATOR Telegram Gateway*",
    "",
    "Send a URL, YouTube link, or upload a file. The bot converts it to Markdown and HTML, saves it in the normal knowledge workspace, then sends the artifacts back.",
    "",
    commandText()
  ].join("\n");
}

function commandText(): string {
  return [
    "*Commands*",
    "`/convert_url <url>` — convert a web page or YouTube link",
    "`/convert_file` — show file upload instructions",
    "`/status` — show workspace counts",
    "`/search <query>` — search local Markdown and wiki",
    "`/ask <query>` — answer from local evidence only",
    "`/health` — run health check and return reports",
    "`/render_portal` — rebuild portal HTML",
    "`/compile_wiki` — refresh wiki indexes",
    "`/process_inbox` — ingest files from workspace + Hindsight incoming",
    "`/ingest <path>` — ingest a file or folder into the knowledge base",
    "`/memory_export` — export memory-card JSONL",
    "`/daily_log [note]` — create or update today's daily log",
    "`/immortal_mode status|on|off` — bot auto-restart watchdog",
    "",
    "*Webscraping*",
    "`/scrape_fetch <url>` — fetch through tier chain",
    "`/scrape_detect <url>` — check anti-bot protection",
    "`/scrape_crawl <cmd> <args>` — manage crawls (start|pause|resume|status|list)",
    "`/scrape_health` — check Scrapling Python bridge",
    "`/scrape_stats` — protection event statistics",
    "",
    "*YouTube → MP3*",
    "`/youtube_to_mp3 <url>` — convert a single YouTube video to MP3 (returns the file in chat)",
    "`/youtube_playlist_to_mp3 <url>` — convert entire playlist to MP3 (returns files one by one)",
    "`/stop` — kill the running operation and delete its residual files",
    "",
    "Environment: `BOT_key`, `BOT_KEY`, or `TELEGRAM_BOT_TOKEN`; optional `ASSIMILATOR_WORKSPACE`.",
  ].join("\n");
}

// ── Immortal mode helpers ─────────────────────────────────────────────
async function runScript(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("bash", [script, ...args], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── Immortal mode Telegram handler ────────────────────────────────────
bot.onText(/^\/immortal(?:_|-)mode\b/, async (message) => {
  const text = message.text || "";
  const parts = text.split(/\s+/);
  const subcmd = parts[1]?.toLowerCase();
  const intervalArg = parts[2];

  if (!subcmd || subcmd === "help") {
    await bot.sendMessage(message.chat.id, [
      "🛡️ *Immortal Mode — Auto-restart watchdog*",
      "",
      "`/immortal-mode status`    — check if watchdog is active",
      "`/immortal-mode on`        — enable (default: 5 min recheck)",
      "`/immortal-mode on 60m`   — enable with custom interval",
      "`/immortal-mode off`       — disable watchdog",
      "",
      "*Intervals:* `5m` `10m` `30m` `1h` `2h` `12h` `24h`",
      "",
      "Controls the cron watchdog for both bots.",
    ].join("\n"), { parse_mode: "Markdown" });
    return;
  }

  if (subcmd === "status") {
    const out = await runScript("/Users/musichen/.hermes/scripts/immortal-mode-status.sh");
    await bot.sendMessage(message.chat.id, `\`\`\`\n${out}\n\`\`\``, { parse_mode: "Markdown" });
    return;
  }

  if (subcmd === "off") {
    await bot.sendMessage(message.chat.id, "🔴 Disabling immortal mode…");
    const out = await runScript("/Users/musichen/.hermes/scripts/immortal-mode-off.sh");
    await bot.sendMessage(message.chat.id, `\`\`\`\n${out}\n\`\`\``, { parse_mode: "Markdown" });
    return;
  }

  if (subcmd === "on") {
    const interval = intervalArg || "5m";
    await bot.sendMessage(message.chat.id, `🟢 Enabling immortal mode (recheck: ${interval})…`);
    const out = await runScript("/Users/musichen/.hermes/scripts/immortal-mode-on.sh", ["--recheck", interval]);
    await bot.sendMessage(message.chat.id, `\`\`\`\n${out}\n\`\`\``, { parse_mode: "Markdown" });
    return;
  }

  await bot.sendMessage(message.chat.id, `Unknown subcommand: ${subcmd}\nSend \`/immortal-mode help\`.`);
});
