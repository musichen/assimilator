#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import React from "react";
import { render } from "ink";
import { initWorkspace } from "./core/workspace.js";
import { resolveWorkspace, DEFAULT_WORKSPACE } from "./core/paths.js";
import { getWorkspaceStatus } from "./core/status.js";
import { ingestFile, ingestFolder, ingestUrl, processInbox } from "./core/ingest.js";
import { convertAnything } from "./core/convert.js";
import { renderPortal } from "./portal/render.js";
import { searchWorkspace } from "./search/search.js";
import { askLocal } from "./search/ask.js";
import { exportMemoryCards } from "./memory/export.js";
import { runHealthCheck } from "./health/checker.js";
import { writeDailyLog } from "./wiki/daily-log.js";
import { suggestConcepts, suggestLinks } from "./wiki/suggestions.js";
import { inventoryLibrary } from "./library/inventory.js";
import { AssimilatorTui } from "./tui/app.js";
import {
  webscrapeFetch, webscrapeDetect, webscrapeHealth, webscrapeStats,
  webscrapeCrawlStart, webscrapeCrawlPause, webscrapeCrawlResume,
  webscrapeCrawlCancel, webscrapeCrawlStatus, webscrapeCrawlList,
} from "./core/webscrape.js";
import {
  youtubeToMp3, youtubePlaylistToMp3,
  isYoutubeUrl, isYoutubePlaylistUrl,
} from "./converters/youtube-mp3.js";

const program = new Command();

program
  .name("assimilate")
  .description("ASSIMILATOR local-first knowledge compiler")
  .version("0.1.0")
  .option("-w, --workspace <path>", "knowledge workspace path", DEFAULT_WORKSPACE);

program
  .command("init")
  .argument("[workspace]", "workspace path")
  .description("initialize a portable ASSIMILATOR knowledge workspace")
  .action(async (workspaceArg?: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(workspaceArg ?? program.opts().workspace);
      const result = await initWorkspace(workspace);
      console.log(`Initialized ${result.workspace}`);
      console.log(`Directories ensured: ${result.createdDirectories}`);
      console.log(`Files created: ${result.createdFiles.length}`);
    });
  });

program
  .command("status")
  .description("show workspace status")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const status = await getWorkspaceStatus(workspace);
      console.log(`Workspace: ${workspace}`);
      console.log(`Initialized: ${status.initialized ? "yes" : "no"}`);
      for (const [key, value] of Object.entries(status.counts)) {
        console.log(`${key}: ${value}`);
      }
    });
  });

program
  .command("ingest-file")
  .argument("<path>", "local TXT, MD, or HTML file")
  .option("-t, --title <title>", "title override")
  .option("--tag <tag...>", "tags")
  .description("preserve a local file and generate Markdown, wiki, metadata, and logs")
  .action(async (inputPath: string, options: { title?: string; tag?: string[] }) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await ingestFile(workspace, inputPath, {
        title: options.title,
        tags: options.tag ?? []
      });
      printIngestResult(workspace, path.resolve(inputPath), result);
    });
  });

program
  .command("convert")
  .option("-f, --file <path>", "file to convert")
  .option("-u, --url <url>", "URL to convert")
  .option("-o, --output-dir <path>", "directory for Markdown, HTML, and metadata output")
  .option("-t, --title <title>", "title override")
  .option("--no-save", "do not save conversion artifacts")
  .option("--print <format>", "print markdown, html, or json", "json")
  .option("-q, --quiet", "suppress progress output")
  .description("convert a file or URL to Markdown and HTML")
  .action(async (options: { file?: string; url?: string; outputDir?: string; title?: string; save?: boolean; print?: string; quiet?: boolean }) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const started = Date.now();
      const progress = options.quiet ? undefined : (message: string) => {
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        process.stderr.write(`[${elapsed}s] ${message}\n`);
      };
      const result = await convertAnything({
        filePath: options.file,
        url: options.url,
        title: options.title,
        workspace,
        outputDir: options.outputDir,
        save: options.save,
        onProgress: progress
      });
      progress?.("Done");
      switch (options.print) {
        case "markdown":
        case "md":
          console.log(result.markdown);
          break;
        case "html":
          console.log(result.html);
          break;
        default:
          console.log(JSON.stringify({
            id: result.id,
            title: result.title,
            sourceType: result.sourceType,
            source: result.source,
            markdownPath: result.markdownPath,
            htmlPath: result.htmlPath,
            metadataPath: result.metadataPath
          }, null, 2));
      }
    });
  });

program
  .command("tui")
  .description("open the interactive Ink conversion TUI")
  .action(async () => {
    const workspace = resolveWorkspace(program.opts().workspace);
    await fs.mkdir(workspace, { recursive: true });
    render(React.createElement(AssimilatorTui, { workspace }));
  });

program
  .command("ingest")
  .argument("<path>", "local source path")
  .description("alias for ingest-file in the MVP")
  .action(async (inputPath: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await ingestFile(workspace, inputPath);
      printIngestResult(workspace, path.resolve(inputPath), result);
    });
  });

program
  .command("ingest-url")
  .argument("<url>", "URL to convert through Markit and preserve as Markdown")
  .option("-t, --title <title>", "title override")
  .option("--tag <tag...>", "tags")
  .description("ingest a URL into raw/web, processed Markdown, wiki, and indexes")
  .action(async (url: string, options: { title?: string; tag?: string[] }) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await ingestUrl(workspace, url, { title: options.title, tags: options.tag ?? ["web"] });
      printIngestResult(workspace, url, result);
    });
  });

program
  .command("ingest-youtube")
  .argument("<youtube_url>", "YouTube URL")
  .description("ingest a YouTube URL through the URL ingestion path")
  .action(async (url: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await ingestUrl(workspace, url, { tags: ["youtube"] });
      printIngestResult(workspace, url, result);
    });
  });

program
  .command("ingest-folder")
  .argument("<path>", "folder path")
  .option("--tag <tag...>", "tags")
  .description("ingest supported files from a folder without deleting or moving originals")
  .action(async (folderPath: string, options: { tag?: string[] }) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const results = await ingestFolder(workspace, folderPath, { tags: options.tag ?? ["folder"] });
      console.log(`Ingested files: ${results.length}`);
    });
  });

program
  .command("ingest-book")
  .argument("<path>", "selected book path")
  .description("ingest one selected book file")
  .action(async (bookPath: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await ingestFile(workspace, bookPath, { tags: ["book"] });
      printIngestResult(workspace, path.resolve(bookPath), result);
    });
  });

program
  .command("ingest-image")
  .argument("<path>", "selected image path")
  .description("ingest one selected image file through Markit metadata conversion")
  .action(async (imagePath: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await ingestFile(workspace, imagePath, { tags: ["image"] });
      printIngestResult(workspace, path.resolve(imagePath), result);
    });
  });

program
  .command("ingest-repo")
  .argument("<url_or_path>", "repository URL or local path")
  .description("ingest a repo URL through Markit or a local repo folder as supported files")
  .action(async (repo: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      if (/^https?:\/\//.test(repo)) {
        const result = await ingestUrl(workspace, repo, { tags: ["repo"] });
        printIngestResult(workspace, repo, result);
        return;
      }
      const results = await ingestFolder(workspace, repo, { tags: ["repo"] });
      console.log(`Ingested repo files: ${results.length}`);
    });
  });

program
  .command("process-inbox")
  .description("ingest supported files from workspace inbox folders")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const results = await processInbox(workspace);
      console.log(`Inbox items processed: ${results.length}`);
    });
  });

program
  .command("compile-wiki")
  .description("refresh wiki indexes")
  .action(async () => {
    await runCli(async () => {
      const { updateWikiIndexes } = await import("./wiki/indexes.js");
      const workspace = resolveWorkspace(program.opts().workspace);
      await updateWikiIndexes(workspace);
      console.log("Wiki indexes refreshed.");
    });
  });

program
  .command("render-portal")
  .description("render wiki Markdown into a local HTML portal")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await renderPortal(workspace);
      console.log(`Rendered pages: ${result.pagesRendered}`);
      console.log(`Portal index: ${result.indexPath}`);
    });
  });

program
  .command("search")
  .argument("<query>", "search query")
  .description("search processed Markdown and wiki pages")
  .action(async (query: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const matches = await searchWorkspace(workspace, query);
      if (matches.length === 0) {
        console.log("No matches.");
        return;
      }
      for (const match of matches) {
        console.log(`${match.file}:${match.line}: ${match.text}`);
      }
    });
  });

program
  .command("ask")
  .argument("<query>", "local question")
  .description("answer with local source-linked evidence only")
  .action(async (query: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await askLocal(workspace, query);
      console.log(result.answer);
    });
  });

program
  .command("memory-export")
  .description("export source-linked memory cards for Hermes and Hindsight")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await exportMemoryCards(workspace);
      console.log(`Memory cards: ${result.cards.length}`);
      console.log(`Hermes: ${result.hermesPath}`);
      console.log(`Hindsight: ${result.hindsightPath}`);
    });
  });

program
  .command("hindsight-export")
  .description("alias for memory-export")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await exportMemoryCards(workspace);
      console.log(`Hindsight: ${result.hindsightPath}`);
    });
  });

program
  .command("health-check")
  .description("write JSON and Markdown health reports")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await runHealthCheck(workspace);
      const errors = result.issues.filter((issue) => issue.severity === "error").length;
      const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
      const info = result.issues.filter((issue) => issue.severity === "info").length;
      console.log(`Issues: ${result.issues.length} (${errors} errors, ${warnings} warnings, ${info} info)`);
      console.log(`Markdown: ${result.markdownPath}`);
      console.log(`JSON: ${result.jsonPath}`);
    });
  });

program
  .command("suggest-concepts")
  .description("list extracted concept candidates from metadata")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const concepts = await suggestConcepts(workspace);
      if (concepts.length === 0) {
        console.log("No concept suggestions yet.");
        return;
      }
      for (const concept of concepts.slice(0, 50)) {
        console.log(`${concept.concept}: ${concept.count} source(s)`);
      }
    });
  });

program
  .command("suggest-links")
  .description("list source-to-concept link suggestions")
  .action(async () => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const links = await suggestLinks(workspace);
      if (links.length === 0) {
        console.log("No link suggestions yet.");
        return;
      }
      for (const link of links) {
        console.log(`${link.source} -> [[${link.concept}]] (${link.target})`);
      }
    });
  });

program
  .command("daily-log")
  .option("--date <date>", "YYYY-MM-DD date")
  .option("--priority <priority>", "main priority")
  .option("--note <note>", "note to append")
  .description("create or update a daily log page")
  .action(async (options: { date?: string; priority?: string; note?: string }) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await writeDailyLog(workspace, options);
      console.log(`${result.created ? "Created" : "Updated"} ${path.relative(workspace, result.path)}`);
    });
  });

program
  .command("inventory-library")
  .argument("<path>", "book library path")
  .description("inventory a book library without ingesting full books")
  .action(async (libraryPath: string) => {
    await runCli(async () => {
      const workspace = resolveWorkspace(program.opts().workspace);
      const result = await inventoryLibrary(workspace, libraryPath);
      console.log(`Items inventoried: ${result.items.length}`);
      console.log(`JSONL: ${result.jsonlPath}`);
      console.log(`Markdown: ${result.markdownPath}`);
    });
  });

await program.parseAsync();

// ═══════════════════════════════════════════════════════════════════════
// Webscrape commands
// ═══════════════════════════════════════════════════════════════════════

program
  .command("webscrape-fetch")
  .argument("<url>", "URL to fetch through the multi-tier chain")
  .option("--json", "output as JSON")
  .description("fetch a URL through HTTP→Stealthy→Dynamic→Chrome tier chain")
  .action(async (url: string, options: { json?: boolean }) => {
    await runCli(async () => {
      const result = await webscrapeFetch(url);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.success) {
          console.log(`✅ ${result.tier} tier | ${result.status} | ${result.elapsedMs}ms | ${result.bodyLength} bytes`);
          if (result.title) console.log(`Title: ${result.title}`);
          if (result.protection) console.log(`Protection: ${result.protection}`);
          if (result.snippet) console.log(`\nPreview:\n${result.snippet.slice(0, 300)}`);
        } else {
          console.log(`❌ ${result.error}`);
        }
      }
    });
  });

program
  .command("webscrape-detect")
  .argument("<url>", "URL to scan for anti-bot protection")
  .option("--json", "output as JSON")
  .description("detect anti-bot/WAF protection on a URL")
  .action(async (url: string, options: { json?: boolean }) => {
    await runCli(async () => {
      const result = await webscrapeDetect(url);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.detected) {
          console.log(`🛡️ ${result.type} (${result.confidence}) — status ${result.status}`);
        } else {
          console.log(`✅ No protection detected (status ${result.status})`);
        }
      }
    });
  });

program
  .command("webscrape-crawl")
  .argument("<url>", "seed URL to start crawling from")
  .option("-d, --depth <n>", "max link depth (default 2)", "2")
  .option("-p, --pages <n>", "max pages (default 50)", "50")
  .option("--json", "output as JSON")
  .description("start a background crawl with pause/resume")
  .action(async (url: string, options: { depth?: string; pages?: string; json?: boolean }) => {
    await runCli(async () => {
      const result = await webscrapeCrawlStart([url], {
        maxDepth: parseInt(options.depth ?? "2"),
        maxPages: parseInt(options.pages ?? "50"),
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`🕷️ ${result.message}`);
      }
    });
  });

program
  .command("webscrape-crawl-pause")
  .argument("<crawlId>", "crawl ID to pause")
  .description("pause a running crawl")
  .action(async (crawlId: string) => {
    await runCli(async () => {
      console.log(await webscrapeCrawlPause(crawlId));
    });
  });

program
  .command("webscrape-crawl-resume")
  .argument("<crawlId>", "crawl ID to resume")
  .description("resume a paused crawl")
  .action(async (crawlId: string) => {
    await runCli(async () => {
      console.log(await webscrapeCrawlResume(crawlId));
    });
  });

program
  .command("webscrape-crawl-cancel")
  .argument("<crawlId>", "crawl ID to cancel")
  .description("cancel a crawl")
  .action(async (crawlId: string) => {
    await runCli(async () => {
      console.log(await webscrapeCrawlCancel(crawlId));
    });
  });

program
  .command("webscrape-crawl-status")
  .argument("<crawlId>", "crawl ID")
  .option("--json", "output as JSON")
  .description("show crawl state and stats")
  .action(async (crawlId: string, options: { json?: boolean }) => {
    await runCli(async () => {
      const state = await webscrapeCrawlStatus(crawlId);
      if (!state) {
        console.log(`Crawl ${crawlId} not found`);
        return;
      }
      if (options.json) {
        const { results, ...rest } = state;
        console.log(JSON.stringify({ ...rest, resultCount: results.length }, null, 2));
      } else {
        console.log(`🕷️ ${state.id} — ${state.status}`);
        console.log(`Pages: ${state.stats.pagesCrawled} crawled / ${state.stats.pagesFailed} failed / ${state.queue.length} queued`);
        console.log(`Bytes: ${state.stats.bytesDownloaded}`);
        if (state.error) console.log(`Error: ${state.error}`);
      }
    });
  });

program
  .command("webscrape-crawl-list")
  .option("--json", "output as JSON")
  .description("list all crawls")
  .action(async (options: { json?: boolean }) => {
    await runCli(async () => {
      const crawls = await webscrapeCrawlList();
      if (options.json) {
        console.log(JSON.stringify(crawls.map(c => ({ id: c.id, status: c.status, stats: c.stats })), null, 2));
      } else {
        if (crawls.length === 0) {
          console.log("No crawls active.");
          return;
        }
        for (const c of crawls) {
          console.log(`🕷️ ${c.id.slice(0, 8)}  ${c.status.padEnd(12)} ${c.stats.pagesCrawled} pages  ${c.config.startUrls[0]}`);
        }
      }
    });
  });

program
  .command("webscrape-health")
  .option("--json", "output as JSON")
  .description("check Python Scrapling bridge health")
  .action(async (options: { json?: boolean }) => {
    await runCli(async () => {
      const result = await webscrapeHealth();
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.healthy ? "✅" : "❌", result.message);
      }
    });
  });

program
  .command("webscrape-stats")
  .option("--json", "output as JSON")
  .description("show anti-bot protection event statistics")
  .action(async (options: { json?: boolean }) => {
    await runCli(async () => {
      const stats = webscrapeStats();
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`🛡️ Protection events: ${stats.totalEvents}`);
        console.log("\nBy type:");
        for (const [type, info] of Object.entries(stats.summary)) {
          console.log(`  ${type}: ${info.count}x (tiers: ${info.tiers.join(", ")})`);
        }
        if (stats.recentEvents.length > 0) {
          console.log("\nRecent:");
          for (const e of stats.recentEvents.slice(0, 5)) {
            console.log(`  ${e.detectedAt.slice(11, 19)}  ${e.protection.padEnd(25)} ${e.tier}  ${e.url.slice(0, 60)}`);
          }
        }
      }
    });
  });

// ═══════════════════════════════════════════════════════════════════════
// YouTube → MP3 commands
// ═══════════════════════════════════════════════════════════════════════

program
  .command("youtube-to-mp3")
  .argument("<url>", "YouTube video URL to convert to MP3")
  .option("-o, --output <dir>", "output directory", "results/mp3")
  .option("--json", "output as JSON")
  .description("download a YouTube video, extract audio, and convert to MP3 with metadata")
  .action(async (url: string, options: { output?: string; json?: boolean }) => {
    await runCli(async () => {
      const outDir = path.resolve(options.output ?? "results/mp3");
      if (!isYoutubeUrl(url)) {
        throw new Error(`Not a YouTube URL: ${url}`);
      }
      const result = await youtubeToMp3(url, outDir, (msg) => process.stderr.write(`${msg}\n`));
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`🎵 ${result.title}`);
        console.log(`📁 ${result.filePath}`);
        console.log(`📦 ${(result.size / 1024 / 1024).toFixed(1)} MB`);
      }
    });
  });

program
  .command("youtube-playlist-to-mp3")
  .argument("<url>", "YouTube playlist URL to convert all items to MP3")
  .option("-o, --output <dir>", "output directory", "results/mp3")
  .option("--json", "output as JSON")
  .description("download every video in a YouTube playlist, extract audio, and convert to MP3")
  .action(async (url: string, options: { output?: string; json?: boolean }) => {
    await runCli(async () => {
      const outDir = path.resolve(options.output ?? "results/mp3");
      if (!isYoutubePlaylistUrl(url)) {
        throw new Error(`Not a YouTube playlist URL: ${url}`);
      }
      const result = await youtubePlaylistToMp3(url, outDir, (msg) => process.stderr.write(`${msg}\n`));
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n✅ ${result.items.length} converted, ${result.errors.length} failed`);
        for (const item of result.items) {
          console.log(`  🎵 ${item.title} (${(item.size / 1024 / 1024).toFixed(1)} MB)`);
        }
        for (const err of result.errors) {
          console.log(`  ❌ ${err.title}: ${err.error}`);
        }
      }
    });
  });

async function runCli(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function printIngestResult(workspace: string, input: string, result: Awaited<ReturnType<typeof ingestFile>>): void {
  console.log(`Ingested ${input}`);
  console.log(`Source ID: ${result.metadata.id}`);
  console.log(`Processed Markdown: ${result.metadata.processed_markdown_path}`);
  console.log(`Wiki Page: ${path.relative(workspace, result.wikiPath)}`);
}
