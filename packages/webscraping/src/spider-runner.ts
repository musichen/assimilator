/**
 * spider-runner.ts — Large-crawl orchestrator with pause/resume.
 *
 * Manages multi-page crawl jobs: configurable depth, concurrency, domain
 * scoping, URL discovery, and state persistence. Uses `fetchWithFallback`
 * from the fetcher chain to leverage Scrapling's session-based fetchers
 * through all four tiers (HTTP → Stealthy → Dynamic → Chrome).
 *
 * Crawl state is serialised to disk so paused crawls survive restarts.
 *
 * API:
 *   startCrawl(config)  → crawlId
 *   pauseCrawl(id)      → void
 *   resumeCrawl(id)     → void
 *   cancelCrawl(id)     → void
 *   getCrawlState(id)   → CrawlState | null
 *   listCrawls()        → CrawlState[]
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fetchWithFallback } from "./fetcher-chain.js";
import type { FetchResult } from "./types.js";

// ---------------------------------------------------------------------------
// Crawl configuration
// ---------------------------------------------------------------------------

/** Scoping rules for a crawl. */
export interface CrawlScope {
  /** Only follow links whose hostname matches one of these domains. */
  allowedDomains?: string[];
  /** Regex patterns a URL must match to be enqueued. */
  includePatterns?: string[];
  /** Regex patterns a URL must NOT match (exclusion takes precedence). */
  excludePatterns?: string[];
  /** Limit to paths with these prefixes on the same domain. */
  pathPrefixes?: string[];
}

/** Full configuration for a crawl job. */
export interface CrawlConfig {
  /** Seed URLs — the crawl starts here. */
  startUrls: string[];
  /** Maximum link depth from a seed URL (default 3). */
  maxDepth?: number;
  /** Hard cap on pages fetched (default 500). */
  maxPages?: number;
  /** Maximum concurrent fetches (default 3). */
  concurrency?: number;
  /** Minimum delay between fetches to the same domain (ms, default 1000). */
  requestDelayMs?: number;
  /** Domain / path / pattern scoping (optional — no scoping = crawl all). */
  scope?: CrawlScope;
  /** Honour robots.txt (default false). */
  respectRobotsTxt?: boolean;
  /** Custom User-Agent sent with every request. */
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Crawl stats
// ---------------------------------------------------------------------------

export interface CrawlStats {
  pagesCrawled: number;
  pagesQueued: number;
  pagesFailed: number;
  bytesDownloaded: number;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Queue entry
// ---------------------------------------------------------------------------

export interface CrawlQueueEntry {
  url: string;
  depth: number;
  parentUrl?: string;
  priority: number;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Crawl result per page
// ---------------------------------------------------------------------------

export interface CrawlPageResult {
  url: string;
  finalUrl: string;
  status: number;
  depth: number;
  links: string[];
  fetchResult: FetchResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Crawl state (serialisable)
// ---------------------------------------------------------------------------

export type CrawlStatus = "idle" | "running" | "paused" | "completed" | "error";

export interface CrawlState {
  id: string;
  config: CrawlConfig;
  status: CrawlStatus;
  stats: CrawlStats;
  queue: CrawlQueueEntry[];
  visited: string[];
  results: CrawlPageResult[];
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// In-memory registry + persistence
// ---------------------------------------------------------------------------

const STATE_DIR = join(
  process.env.HOME ?? "/tmp",
  ".assimilator",
  "crawls",
);

let _ready = false;

async function _ensureDir(): Promise<void> {
  if (!_ready) {
    await mkdir(STATE_DIR, { recursive: true });
    _ready = true;
  }
}

function _statePath(crawlId: string): string {
  return join(STATE_DIR, `${crawlId}.json`);
}

/** In-memory map of active crawl states. */
const _crawls = new Map<string, CrawlState>();

/** Active AbortControllers keyed by crawl ID. */
const _aborts = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function _normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    // Only http(s)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Strip fragment
    url.hash = "";
    // Trailing-slash consistency: ensure exactly one
    const path = url.pathname.replace(/\/+$/, "") || "/";
    url.pathname = path;
    return url.href;
  } catch {
    return null;
  }
}

function _urlMatchesScope(urlStr: string, scope: CrawlScope): boolean {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  // Domain scoping
  if (scope.allowedDomains && scope.allowedDomains.length > 0) {
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    const allowed = scope.allowedDomains.some(
      (d) => d.replace(/^www\./, "").toLowerCase() === hostname,
    );
    if (!allowed) return false;
  }

  // Path prefix scoping
  if (scope.pathPrefixes && scope.pathPrefixes.length > 0) {
    const included = scope.pathPrefixes.some((p) => url.pathname.startsWith(p));
    if (!included) return false;
  }

  // Include patterns
  if (scope.includePatterns && scope.includePatterns.length > 0) {
    const matched = scope.includePatterns.some((p) => new RegExp(p, "i").test(urlStr));
    if (!matched) return false;
  }

  // Exclusion patterns (override)
  if (scope.excludePatterns && scope.excludePatterns.length > 0) {
    const excluded = scope.excludePatterns.some((p) => new RegExp(p, "i").test(urlStr));
    if (excluded) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

const LINK_RE =
  /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;

/**
 * Extract all absolute URLs from anchor tags in an HTML body.
 * Only returns http(s) URLs, deduplicated.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  for (const match of Array.from(html.matchAll(LINK_RE))) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;

    const normalized = _normalizeUrl(raw, baseUrl);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      links.push(normalized);
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

async function _saveState(state: CrawlState): Promise<void> {
  await _ensureDir();
  await writeFile(_statePath(state.id), JSON.stringify(state, null, 2));
}

async function _loadState(crawlId: string): Promise<CrawlState | null> {
  await _ensureDir();
  try {
    const raw = await readFile(_statePath(crawlId), "utf-8");
    return JSON.parse(raw) as CrawlState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Crawl execution
// ---------------------------------------------------------------------------

async function _runCrawl(state: CrawlState): Promise<void> {
  const config = state.config;
  const concurrency = config.concurrency ?? 3;
  const maxPages = config.maxPages ?? 500;
  const maxDepth = config.maxDepth ?? 3;
  const delayMs = config.requestDelayMs ?? 1000;

  // Per-domain last-fetch tracking for throttling
  const domainTimers = new Map<string, number>();

  const controller = new AbortController();
  _aborts.set(state.id, controller);

  let active = 0;
  let done = false;

  async function throttle(domain: string): Promise<void> {
    const last = domainTimers.get(domain) ?? 0;
    const wait = last + delayMs - Date.now();
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    domainTimers.set(domain, Date.now());
  }

  async function processNext(): Promise<void> {
    if (done) return;

    // Find the next queued entry (highest priority, then oldest).
    const idx = state.queue.findIndex(
      (e) => !state.visited.includes(e.url),
    );
    if (idx < 0) {
      // Queue exhausted.
      if (active === 0) {
        done = true;
        state.status = "completed";
        state.completedAt = new Date().toISOString();
        await _saveState(state);
      }
      return;
    }

    const entry = state.queue[idx]!;
    state.visited.push(entry.url);
    state.queue.splice(idx, 1);

    active++;
    const pageStart = Date.now();

    try {
      await throttle(new URL(entry.url).hostname);

      const headers: Record<string, string> = {};
      if (config.userAgent) {
        headers["user-agent"] = config.userAgent;
      }

      const fetchResult = await fetchWithFallback({
        url: entry.url,
        headers,
        timeoutMs: 60_000,
      });

      const links = config.scope
        ? extractLinks(fetchResult.body, entry.url).filter((l) =>
            _urlMatchesScope(l, config.scope!),
          )
        : extractLinks(fetchResult.body, entry.url);

      const pageResult: CrawlPageResult = {
        url: entry.url,
        finalUrl: fetchResult.finalUrl,
        status: fetchResult.status,
        depth: entry.depth,
        links,
        fetchResult,
      };

      state.results.push(pageResult);
      state.stats.pagesCrawled++;
      state.stats.bytesDownloaded += fetchResult.body.length;

      // Enqueue discovered links up to maxDepth.
      if (entry.depth < maxDepth) {
        for (const link of links) {
          if (state.visited.includes(link)) continue;
          if (state.queue.some((e) => e.url === link)) continue;
          if (
            state.stats.pagesQueued >= maxPages
          ) break;

          state.queue.push({
            url: link,
            depth: entry.depth + 1,
            parentUrl: entry.url,
            priority: 0,
            addedAt: new Date().toISOString(),
          });
          state.stats.pagesQueued++;
        }
      }
    } catch (err) {
      state.stats.pagesFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      state.results.push({
        url: entry.url,
        finalUrl: entry.url,
        status: 0,
        depth: entry.depth,
        links: [],
        fetchResult: {
          status: 0,
          headers: {},
          body: "",
          finalUrl: entry.url,
          tier: "http",
          elapsedMs: Date.now() - pageStart,
        },
        error: msg,
      });
    } finally {
      active--;
      state.stats.elapsedMs = Date.now() -
        (state.startedAt ? new Date(state.startedAt).getTime() : Date.now());

      // Persist state periodically (every page, but write is small).
      if (state.status === "running") {
        await _saveState(state);
      }
    }

    // Check termination conditions.
    if (state.stats.pagesCrawled >= maxPages) {
      done = true;
      state.status = "completed";
      state.completedAt = new Date().toISOString();
      await _saveState(state);
      return;
    }

    if (controller.signal.aborted) {
      done = true;
      return;
    }

    // Launch next workers.
    if (!done) {
      void processNext();
    }
  }

  // Kick off initial batch.
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(processNext());
  }

  try {
    await Promise.all(workers);
  } catch (err) {
    if (!done) {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
      state.completedAt = new Date().toISOString();
      await _saveState(state);
    }
  }

  _aborts.delete(state.id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new crawl. Returns the crawl ID immediately — the crawl runs
 * in the background (non-blocking).
 */
export async function startCrawl(config: CrawlConfig): Promise<string> {
  const id = randomUUID();

  const state: CrawlState = {
    id,
    config,
    status: "idle",
    stats: {
      pagesCrawled: 0,
      pagesQueued: 0,
      pagesFailed: 0,
      bytesDownloaded: 0,
      elapsedMs: 0,
    },
    queue: [],
    visited: [],
    results: [],
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    error: null,
  };

  // Seed the queue.
  for (const url of config.startUrls) {
    state.queue.push({
      url,
      depth: 0,
      priority: 1,
      addedAt: new Date().toISOString(),
    });
    state.stats.pagesQueued++;
  }

  state.status = "running";
  state.startedAt = new Date().toISOString();

  _crawls.set(id, state);
  await _saveState(state);

  // Fire-and-forget: the crawl runs asynchronously.
  _runCrawl(state).catch((err) => {
    // Log but don't crash — state.status will be 'error'.
    console.error(`[spider-runner] crawl ${id} errored:`, err);
  });

  return id;
}

/**
 * Pause a running crawl.  The in-flight pages finish, but no new pages
 * are dequeued.  State is persisted so it can be resumed later.
 */
export async function pauseCrawl(crawlId: string): Promise<void> {
  const state = _crawls.get(crawlId);
  if (!state || state.status !== "running") {
    throw new Error(`Crawl ${crawlId} is not running`);
  }

  const controller = _aborts.get(crawlId);
  if (controller) {
    controller.abort();
    _aborts.delete(crawlId);
  }

  state.status = "paused";
  state.pausedAt = new Date().toISOString();
  await _saveState(state);
}

/**
 * Resume a paused crawl.  Re-loads state from disk if it's not in memory.
 */
export async function resumeCrawl(crawlId: string): Promise<void> {
  let state = _crawls.get(crawlId);

  if (!state) {
    const loaded = await _loadState(crawlId);
    if (!loaded) {
      throw new Error(`Crawl ${crawlId} not found`);
    }
    if (loaded.status !== "paused") {
      throw new Error(
        `Crawl ${crawlId} has status "${loaded.status}", expected "paused"`,
      );
    }
    state = loaded;
    _crawls.set(crawlId, state);
  }

  if (state.status !== "paused") {
    throw new Error(
      `Crawl ${crawlId} has status "${state.status}", expected "paused"`,
    );
  }

  state.status = "running";
  state.pausedAt = null;

  // Remove aborted flag from paused URLs that may have been in-flight.
  // The queue entries that were already popped into `visited` but didn't
  // complete need to be re-queued.
  // Strategy: any result in state.results that has status=0 AND error
  // was a failed in-flight page — re-queue it.
  const toRequeue: CrawlQueueEntry[] = [];
  for (const result of state.results) {
    if (result.status === 0 && result.error) {
      // This page didn't complete — put it back.
      state.visited = state.visited.filter((v) => v !== result.url);
      toRequeue.push({
        url: result.url,
        depth: result.depth,
        parentUrl: undefined,
        priority: 1,
        addedAt: new Date().toISOString(),
      });
    }
  }
  // Remove incomplete results.
  state.results = state.results.filter(
    (r) => r.status !== 0 || !r.error,
  );

  // Put incomplete entries back at the front.
  state.queue = [...toRequeue, ...state.queue];

  await _saveState(state);

  _runCrawl(state).catch((err) => {
    console.error(`[spider-runner] crawl ${crawlId} errored:`, err);
  });
}

/**
 * Cancel a crawl.  In-flight pages are abandoned; state is removed.
 */
export async function cancelCrawl(crawlId: string): Promise<void> {
  const controller = _aborts.get(crawlId);
  if (controller) {
    controller.abort();
    _aborts.delete(crawlId);
  }

  _crawls.delete(crawlId);

  try {
    await unlink(_statePath(crawlId));
  } catch {
    // File already gone — fine.
  }
}

/**
 * Get the current state of a crawl (from memory, falling back to disk).
 */
export async function getCrawlState(
  crawlId: string,
): Promise<CrawlState | null> {
  const mem = _crawls.get(crawlId);
  if (mem) return mem;
  return _loadState(crawlId);
}

/**
 * List all crawl states currently on disk.
 */
export async function listCrawls(): Promise<CrawlState[]> {
  await _ensureDir();
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(STATE_DIR);
  const states: CrawlState[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    const state = await _loadState(id);
    if (state) states.push(state);
  }

  return states;
}
