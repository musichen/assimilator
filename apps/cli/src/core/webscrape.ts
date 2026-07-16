/**
 * core/webscrape.ts — Webscraping operations for CLI, TUI, and TG bot.
 */

import {
  fetchWithFallback,
  detectProtection,
  getProtectionEvents,
  protectionSummary,
  bridgeHealth,
  startCrawl,
  pauseCrawl,
  resumeCrawl,
  cancelCrawl,
  getCrawlState,
  listCrawls,
} from "@assimilator/webscraping";
import type { CrawlConfig, CrawlState } from "@assimilator/webscraping";

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface WebscrapeFetchResult {
  success: boolean;
  url: string;
  tier?: string;
  status?: number;
  bodyLength?: number;
  elapsedMs?: number;
  title?: string;
  protection?: string;
  snippet?: string;
  error?: string;
}

export async function webscrapeFetch(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<WebscrapeFetchResult> {
  onProgress?.(`Fetching ${url} through tier chain...`);

  try {
    const result = await fetchWithFallback({ url, timeoutMs: 30_000 });

    const titleMatch = result.body.match(/<title[^>]*>([^<]+)<\/title>/i);
    const protection = detectProtection(result.body, result.status, result.headers);

    onProgress?.(`Done — ${result.tier} tier, ${result.elapsedMs}ms, ${result.body.length} bytes`);

    return {
      success: true,
      url: result.finalUrl,
      tier: result.tier,
      status: result.status,
      bodyLength: result.body.length,
      elapsedMs: result.elapsedMs,
      title: titleMatch?.[1]?.trim(),
      protection: protection.detected ? `${protection.type} (${protection.confidence})` : undefined,
      snippet: result.body.slice(0, 500),
    };
  } catch (error) {
    return {
      success: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Detect protection
// ---------------------------------------------------------------------------

export interface ProtectionResult {
  url: string;
  detected: boolean;
  type: string;
  confidence: string;
  status?: number;
}

export async function webscrapeDetect(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<ProtectionResult> {
  onProgress?.(`Fetching ${url} to detect protection...`);

  try {
    const result = await fetchWithFallback({ url, timeoutMs: 20_000, maxBytes: 100_000 });
    const protection = detectProtection(result.body, result.status, result.headers);

    return {
      url: result.finalUrl,
      detected: protection.detected,
      type: protection.type,
      confidence: protection.confidence,
      status: result.status,
    };
  } catch (error) {
    return {
      url,
      detected: false,
      type: "unknown",
      confidence: "low",
      status: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Crawl management
// ---------------------------------------------------------------------------

export interface CrawlStartResult {
  crawlId: string;
  message: string;
}

export async function webscrapeCrawlStart(
  startUrls: string[],
  options: Partial<CrawlConfig> = {},
): Promise<CrawlStartResult> {
  const config: CrawlConfig = {
    startUrls,
    maxDepth: options.maxDepth ?? 2,
    maxPages: options.maxPages ?? 50,
    concurrency: options.concurrency ?? 2,
    requestDelayMs: options.requestDelayMs ?? 1000,
  };

  const crawlId = await startCrawl(config);
  return { crawlId, message: `Crawl started — ${crawlId}` };
}

export async function webscrapeCrawlPause(crawlId: string): Promise<string> {
  await pauseCrawl(crawlId);
  return `Crawl ${crawlId} paused`;
}

export async function webscrapeCrawlResume(crawlId: string): Promise<string> {
  await resumeCrawl(crawlId);
  return `Crawl ${crawlId} resumed`;
}

export async function webscrapeCrawlCancel(crawlId: string): Promise<string> {
  await cancelCrawl(crawlId);
  return `Crawl ${crawlId} cancelled`;
}

export type { CrawlState };

export async function webscrapeCrawlStatus(crawlId: string): Promise<CrawlState | null> {
  return getCrawlState(crawlId);
}

export async function webscrapeCrawlList(): Promise<CrawlState[]> {
  return listCrawls();
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function webscrapeHealth(): Promise<{ healthy: boolean; message: string }> {
  const healthy = await bridgeHealth();
  return {
    healthy,
    message: healthy
      ? "Python Scrapling bridge is alive and healthy"
      : "Python Scrapling bridge is not responding",
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface WebscrapeStats {
  totalEvents: number;
  summary: Record<string, { count: number; tiers: string[] }>;
  recentEvents: Array<{
    url: string;
    protection: string;
    tier: string;
    detectedAt: string;
  }>;
}

export function webscrapeStats(): WebscrapeStats {
  const events = getProtectionEvents();
  const raw = protectionSummary();
  const summary: Record<string, { count: number; tiers: string[] }> = {};
  for (const [key, val] of Object.entries(raw)) {
    summary[key] = { count: val.count, tiers: [...val.tiers] };
  }

  return {
    totalEvents: events.length,
    summary,
    recentEvents: events.slice(0, 10).map((e) => ({
      url: e.url,
      protection: e.protection,
      tier: e.tier,
      detectedAt: e.detectedAt,
    })),
  };
}
