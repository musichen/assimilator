/**
 * webscraping converter — Tiered fallback for difficult sites.
 *
 * Uses the @assimilator/webscraping package's multi-tier fetcher chain
 * (HTTP → Stealthy → Dynamic → Chrome) to handle sites with anti-bot
 * protections (Cloudflare, DataDome, LinkedIn, etc.).
 *
 * Wired into the remote-converter pipeline as a fallback when simpler
 * converters (markit-ai, markitdown) fail on protected sites.
 */

import { fetchWithFallback, detectProtection } from "@assimilator/webscraping";
import type { ProtectionType } from "@assimilator/webscraping";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WebscrapingConversionResult {
  markdown: string;
  title?: string;
  warnings: string[];
  /** Which tier of the fetcher chain succeeded. */
  tier: string;
  /** If anti-bot protection was detected. */
  protection?: {
    type: ProtectionType;
    confidence: string;
  };
}

/**
 * Known domains that typically require a browser or stealthy fetcher.
 * Extend this list as new problem sites are discovered.
 */
const DIFFICULT_DOMAINS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "indeed.com",
  "www.indeed.com",
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "twitter.com",
  "x.com",
  "www.x.com",
  "crunchbase.com",
  "www.crunchbase.com",
  "pitchbook.com",
  "www.pitchbook.com",
  "zoominfo.com",
  "www.zoominfo.com",
  "reifen-pneus-online.at",
  "www.reifen-pneus-online.at",
]);

/**
 * Check whether a URL is likely to need the webscraping tier chain
 * (anti-bot-protected or JS-heavy sites).
 */
export function isDifficultSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return DIFFICULT_DOMAINS.has(host) || DIFFICULT_DOMAINS.has(`www.${host}`);
  } catch {
    return false;
  }
}

/**
 * Convert a difficult URL to clean markdown using the multi-tier fetcher.
 *
 * Strategy:
 *  1. Fetch the page through the tier chain (starts at http, falls through
 *     to stealthy → dynamic → chrome as needed).
 *  2. Extract a plain-text title from the HTML.
 *  3. The raw HTML is returned as markdown — post-processing is left to
 *     the calling pipeline (MarkItDown, etc.) which can do a better job
 *     of extracting structured markdown from HTML than we can here.
 *
 * This converter is the "get the page content" step, not the final
 * markdown renderer. It's designed to succeed where simpler HTTP fetchers
 * get blocked.
 */
export async function convertDifficultSite(
  url: string,
  onProgress?: (message: string) => void,
  respectTos?: boolean,
): Promise<WebscrapingConversionResult> {
  const warnings: string[] = [];

  onProgress?.("Attempting multi-tier fetch for protected site");

  try {
    const result = await fetchWithFallback({
      url,
      method: "GET",
      timeoutMs: 60_000,
      maxBytes: 5_000_000, // 5 MB cap
      respectTos,
    });

    onProgress?.(`Success via ${result.tier} tier (${result.elapsedMs}ms, ${result.body.length} bytes)`);

    // Extract title from HTML
    const title = extractHtmlTitle(result.body);

    // Check for protection signals
    const protection = detectProtection(result.body, result.status, result.headers);

    if (protection.detected) {
      warnings.push(
        `Anti-bot protection detected: ${protection.type} (${protection.confidence}), ` +
        `bypassed by ${result.tier} tier`,
      );
    }

    return {
      markdown: result.body, // raw HTML — pipeline will convert
      title: title ?? undefined,
      warnings,
      tier: result.tier,
      protection: protection.detected
        ? { type: protection.type, confidence: protection.confidence }
        : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Webscraping tier chain exhausted for ${url}: ${msg}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHtmlTitle(html: string): string | null {
  // Try <title> tag first
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  // Try og:title meta tag
  const ogMatch = html.match(
    /<meta\s[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  if (ogMatch?.[1]) {
    return ogMatch[1].trim();
  }

  // Try first <h1>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match?.[1]) {
    return h1Match[1].trim();
  }

  return null;
}
