#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import { convertAnything, type ConvertResult } from "../cli/src/core/convert.js";
import { initWorkspace } from "../cli/src/core/workspace.js";
import { resolveWorkspace } from "../cli/src/core/paths.js";
import { getWorkspaceStatus } from "../cli/src/core/status.js";
import { searchWorkspace } from "../cli/src/search/search.js";
import { askLocal } from "../cli/src/search/ask.js";
import { runHealthCheck } from "../cli/src/health/checker.js";
import { renderPortal } from "../cli/src/portal/render.js";
import { updateWikiIndexes } from "../cli/src/wiki/indexes.js";
import { processInbox } from "../cli/src/core/ingest.js";
import { exportMemoryCards } from "../cli/src/memory/export.js";
import { writeDailyLog } from "../cli/src/wiki/daily-log.js";

const token = process.env.BOT_key ?? process.env.BOT_KEY ?? process.env.TELEGRAM_BOT_TOKEN;
const workspace = resolveWorkspace(process.env.ASSIMILATOR_WORKSPACE ?? "knowledge-system");
const tempRoot = path.resolve(".tmp", "telegram");

if (!token) {
  console.error("Missing Telegram bot token. Set BOT_key, BOT_KEY, or TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

await initWorkspace(workspace);
await fsp.mkdir(tempRoot, { recursive: true });

const bot = new TelegramBot(token, { polling: true });
await bot.setMyCommands([
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
  { command: "process_inbox", description: "Process workspace inbox files" },
  { command: "memory_export", description: "Export memory cards" },
  { command: "daily_log", description: "Create or update today's daily log" },
  { command: "commands", description: "List command examples" }
]);

console.log(`ASSIMILATOR Telegram bot is listening. Workspace: ${workspace}`);

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

bot.onText(/^\/start\b/, async (message) => {
  await bot.sendMessage(message.chat.id, helpText(), { parse_mode: "Markdown" });
});

bot.onText(/^\/help\b/, async (message) => {
  await bot.sendMessage(message.chat.id, helpText(), { parse_mode: "Markdown" });
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
    await bot.sendMessage(message.chat.id, [`Workspace: ${workspace}`, `Initialized: ${status.initialized ? "yes" : "no"}`, counts].join("\n"));
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
    await bot.sendMessage(message.chat.id, `Inbox items processed: ${results.length}`);
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

bot.on("document", async (message) => {
  await withChatError(message.chat.id, async () => {
    if (!message.document) return;
    const progress = await bot.sendMessage(message.chat.id, `Downloading ${message.document.file_name ?? "file"}...`);
    const localPath = await downloadTelegramDocument(message);
    await bot.editMessageText(`Downloaded. Converting ${path.basename(localPath)}...`, {
      chat_id: message.chat.id,
      message_id: progress.message_id
    });
    const result = await convertAnything({
      filePath: localPath,
      workspace,
      onProgress: asyncProgress(message.chat.id, progress.message_id)
    });
    await bot.editMessageText(`Conversion complete: ${result.title}`, {
      chat_id: message.chat.id,
      message_id: progress.message_id
    });
    await sendConversionResult(message.chat.id, result);
  });
});

bot.on("message", async (message) => {
  if (!message.text || message.text.startsWith("/") || message.document) return;
  const url = findFirstUrl(message.text);
  if (url) {
    await convertUrlForChat(message.chat.id, url);
  }
});

async function convertUrlForChat(chatId: number, url: string): Promise<void> {
  await withChatError(chatId, async () => {
    const progress = await bot.sendMessage(chatId, `Starting URL conversion:\n${url}`);
    const result = await convertAnything({
      url,
      workspace,
      onProgress: asyncProgress(chatId, progress.message_id)
    });
    await bot.editMessageText(`Conversion complete: ${result.title}`, {
      chat_id: chatId,
      message_id: progress.message_id
    });
    await sendConversionResult(chatId, result);
  });
}

function asyncProgress(chatId: number, messageId: number): (message: string) => void {
  let lastUpdate = 0;
  return (message: string) => {
    const now = Date.now();
    if (now - lastUpdate < 1200) return;
    lastUpdate = now;
    void bot.editMessageText(message, { chat_id: chatId, message_id: messageId }).catch(() => undefined);
  };
}

async function downloadTelegramDocument(message: TelegramBot.Message): Promise<string> {
  if (!message.document) throw new Error("Message has no document.");
  const fileName = safeFileName(message.document.file_name ?? `${message.document.file_unique_id}.bin`);
  const chatDir = path.join(tempRoot, String(message.chat.id));
  await fsp.mkdir(chatDir, { recursive: true });
  const localPath = path.join(chatDir, fileName);
  const link = await bot.getFileLink(message.document.file_id);
  const response = await fetch(link);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(localPath, bytes);
  return localPath;
}

async function sendConversionResult(chatId: number, result: ConvertResult): Promise<void> {
  await bot.sendMessage(chatId, [
    `Saved conversion: ${result.title}`,
    `Markdown: ${result.markdownPath ?? "not saved"}`,
    `HTML: ${result.htmlPath ?? "not saved"}`,
    `Metadata: ${result.metadataPath ?? "not saved"}`
  ].join("\n"));
  if (result.markdownPath) await sendExistingDocument(chatId, result.markdownPath);
  if (result.htmlPath) await sendExistingDocument(chatId, result.htmlPath);
  if (result.metadataPath) await sendExistingDocument(chatId, result.metadataPath);
}

async function sendExistingDocument(chatId: number, filePath: string): Promise<void> {
  await bot.sendDocument(chatId, fs.createReadStream(filePath), {}, {
    filename: path.basename(filePath)
  });
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
    "`/convert_url <url>` - convert a web page or YouTube link",
    "`/convert_file` - show file upload instructions",
    "`/status` - show workspace counts",
    "`/search <query>` - search local Markdown and wiki",
    "`/ask <query>` - answer from local evidence only",
    "`/health` - run health check and return reports",
    "`/render_portal` - rebuild portal HTML",
    "`/compile_wiki` - refresh wiki indexes",
    "`/process_inbox` - ingest files already in the workspace inbox",
    "`/memory_export` - export memory-card JSONL",
    "`/daily_log [note]` - create or update today's daily log",
    "",
    "Environment: `BOT_key`, `BOT_KEY`, or `TELEGRAM_BOT_TOKEN`; optional `ASSIMILATOR_WORKSPACE`."
  ].join("\n");
}
