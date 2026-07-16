/**
 * anti-bot.ts — Detect and log anti-bot / WAF protection pages.
 *
 * Scans HTTP response bodies, headers, and status codes for known anti-bot
 * signatures (Cloudflare Turnstile, Interstitials, JS challenges, DataDome,
 * Akamai, Imperva, Sucuri, generic CAPTCHAs / blocks) and records structured
 * `ProtectionEvent` records that capture:
 *
 *   - Which protection was hit
 *   - Which fetcher tier encountered it
 *   - The response status, headers, and a diagnostic snippet
 *
 * Callers (typically the fetcher chain) use `detectProtection` to classify a
 * response, then `logProtectionEvent` to persist the event for later analysis.
 */

import type {
  FetchResult,
  FetcherTier,
  ProtectionDetection,
  ProtectionEvent,
  ProtectionType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Detection rules — ordered highest-priority first.
// ---------------------------------------------------------------------------

interface DetectionRule {
  type: ProtectionType;
  /** A regex tested against the body (first 5 KB). */
  bodyPattern?: RegExp;
  /** A regex tested against header keys/values (concatenated). */
  headerPattern?: RegExp;
  /** Specific HTTP status codes that are strong indicators. */
  statusCodes?: number[];
  /** Minimum confidence when this rule fires. */
  confidence: "high" | "medium" | "low";
  /** Human-readable label for what was matched. */
  detail: string;
}

const RULES: DetectionRule[] = [
  // ---- Cloudflare family (most specific first) ----
  {
    type: "cloudflare-turnstile",
    bodyPattern: /(?:turnstile|cf-turnstile|challenges\.cloudflare\.com\/turnstile)/i,
    statusCodes: [403, 429],
    confidence: "high",
    detail: "Cloudflare Turnstile widget detected",
  },
  {
    type: "cloudflare-interstitial",
    bodyPattern: /(?:Checking your browser|Just a moment|DDoS protection by Cloudflare|ray\s+id|cf-ray)/i,
    headerPattern: /cf-ray/i,
    statusCodes: [403, 503],
    confidence: "high",
    detail: "Cloudflare interstitial challenge page",
  },
  {
    type: "cloudflare-js-challenge",
    bodyPattern: /(?:cpo_challenge|jschl-answer|__cf_chl_jschl_tk__|cf_challenge)/i,
    headerPattern: /cf-chl-/i,
    statusCodes: [403, 503],
    confidence: "high",
    detail: "Cloudflare JavaScript challenge",
  },
  {
    type: "cloudflare-challenge",
    bodyPattern: /(?:attention required|captcha-bypass|cloudflare.*captcha|cf_captcha)/i,
    statusCodes: [403],
    confidence: "medium",
    detail: "Cloudflare CAPTCHA challenge",
  },
  // Catch-all Cloudflare (lower confidence — could be a CF-proxied legit page).
  {
    type: "cloudflare-challenge",
    bodyPattern: /(?:__cf_bm|cf_clearance)/i,
    headerPattern: /(?:cf-cache-status|cf-ray|server:\s*cloudflare)/i,
    statusCodes: [403, 503],
    confidence: "low",
    detail: "Generic Cloudflare protection cookie / header",
  },

  // ---- Other WAFs ----
  {
    type: "datadome",
    bodyPattern: /(?:datadome|datadome-client|geo-mat|dd-tst)/i,
    headerPattern: /x-datadome/i,
    statusCodes: [403],
    confidence: "high",
    detail: "DataDome bot protection",
  },
  {
    type: "akamai",
    bodyPattern: /(?:akamai|ak_bmsc|bmp_ssl)/i,
    headerPattern: /x-akamai-/i,
    statusCodes: [403],
    confidence: "high",
    detail: "Akamai bot manager",
  },
  {
    type: "imperva",
    bodyPattern: /(?:imperva|incapsula|_incap_|visid_incap)/i,
    headerPattern: /x-iinfo|x-cdn/i,
    statusCodes: [403],
    confidence: "high",
    detail: "Imperva / Incapsula WAF",
  },
  {
    type: "sucuri",
    bodyPattern: /(?:sucuri|sucuri\.net|sucuri-webcloud|sucuri\-cloudproxy|access denied.*sucuri)/i,
    headerPattern: /x-sucuri/i,
    statusCodes: [403],
    confidence: "high",
    detail: "Sucuri website firewall",
  },

  // ---- Generic (lower-priority, broader patterns) ----
  {
    type: "generic-captcha",
    bodyPattern: /(?:recaptcha|hcaptcha|g-recaptcha|arkose|funcaptcha|arkoselabs)/i,
    // Many sites embed reCAPTCHA legitimately — don't treat as blocking unless
    // coupled with a blocking status code.
    statusCodes: [403, 429, 503],
    confidence: "medium",
    detail: "Generic CAPTCHA challenge (reCAPTCHA / hCaptcha / etc.)",
  },
  {
    type: "generic-block",
    bodyPattern: /(?:access denied|blocked|forbidden|request blocked|ip.*block|your ip|security check|please verify|automated access)/i,
    statusCodes: [403],
    confidence: "medium",
    detail: "Generic access-denied or IP-block page",
  },
  {
    type: "generic-block",
    bodyPattern: /(?:enable javascript|cookies must be enabled|please enable cookies)/i,
    statusCodes: [403, 503],
    confidence: "low",
    detail: "JavaScript/Cookie gate (could be Cloudflare or generic)",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a FetchResult (or raw response data) for anti-bot / WAF signals.
 *
 * Returns a `ProtectionDetection` with `detected: false` when nothing is
 * found, or `detected: true` with the matched type, confidence, and detail.
 *
 * @param body      — Response body (first ~5 KB is scanned).
 * @param status    — HTTP status code.
 * @param headers   — Response headers (lower-cased keys recommended).
 */
export function detectProtection(
  body: string,
  status: number,
  headers?: Record<string, string>,
): ProtectionDetection {
  const sample = body.slice(0, 5_120); // scan first 5 KB

  // Build a single header string for header-pattern matching.
  const headerStr = headers
    ? Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  for (const rule of RULES) {
    // If the rule requires specific status codes and this one doesn't match,
    // skip to the next rule.
    if (rule.statusCodes && !rule.statusCodes.includes(status)) {
      continue;
    }

    let matched = false;

    if (rule.bodyPattern && rule.bodyPattern.test(sample)) {
      matched = true;
    }

    if (!matched && rule.headerPattern && rule.headerPattern.test(headerStr)) {
      matched = true;
    }

    if (matched) {
      return {
        detected: true,
        type: rule.type,
        confidence: rule.confidence,
        details: rule.detail,
      };
    }
  }

  return {
    detected: false,
    type: "unknown",
    confidence: "low",
    details: "No anti-bot signature detected",
  };
}

/**
 * Convenience wrapper: scan a FetchResult for anti-bot signals.
 */
export function detectFromResult(
  result: FetchResult,
): ProtectionDetection {
  return detectProtection(result.body, result.status, result.headers);
}

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

/** In-memory ring buffer of recent protection events (max 500 entries). */
const _eventLog: ProtectionEvent[] = [];
const MAX_LOG_SIZE = 500;

/**
 * Record a protection event that was encountered during fetching.
 *
 * @param url       — The URL that was being fetched.
 * @param tier      — Which fetcher tier hit the protection.
 * @param detection — The detection result from `detectProtection`.
 * @param result    — The FetchResult (or partial) that triggered the detection.
 */
export function logProtectionEvent(
  url: string,
  tier: FetcherTier,
  detection: ProtectionDetection,
  result: Pick<FetchResult, "status" | "headers"> & {
    body?: string;
  },
): ProtectionEvent {
  const event: ProtectionEvent = {
    url,
    tier,
    protection: detection.type,
    statusCode: result.status,
    detectedAt: new Date().toISOString(),
    headers: result.headers ?? {},
    snippet: (result.body ?? "").slice(0, 200),
  };

  _eventLog.push(event);
  if (_eventLog.length > MAX_LOG_SIZE) {
    _eventLog.shift();
  }

  return event;
}

/**
 * Return all recorded protection events, newest first.
 */
export function getProtectionEvents(): readonly ProtectionEvent[] {
  return [..._eventLog].reverse();
}

/**
 * Return protection events filtered by criteria.
 */
export function queryProtectionEvents(opts: {
  url?: string;
  tier?: FetcherTier;
  protection?: ProtectionType;
  since?: string; // ISO-8601
  limit?: number;
}): ProtectionEvent[] {
  let results = [..._eventLog];

  if (opts.url) {
    results = results.filter((e) => e.url === opts.url);
  }
  if (opts.tier) {
    results = results.filter((e) => e.tier === opts.tier);
  }
  if (opts.protection) {
    results = results.filter((e) => e.protection === opts.protection);
  }
  if (opts.since) {
    const sinceMs = new Date(opts.since).getTime();
    results = results.filter((e) => new Date(e.detectedAt).getTime() >= sinceMs);
  }

  results.reverse(); // newest first
  if (opts.limit && opts.limit > 0) {
    results = results.slice(0, opts.limit);
  }

  return results;
}

/**
 * Clear the in-memory event log.
 */
export function clearProtectionEvents(): void {
  _eventLog.length = 0;
}

/**
 * Return a summary of which protection types were hit by which tiers.
 * Useful for dashboards / diagnostics.
 */
export function protectionSummary(): Record<
  string,
  { count: number; tiers: Set<FetcherTier> }
> {
  const summary: Record<string, { count: number; tiers: Set<FetcherTier> }> =
    {};

  for (const event of _eventLog) {
    const key = event.protection;
    if (!summary[key]) {
      summary[key] = { count: 0, tiers: new Set() };
    }
    summary[key].count += 1;
    summary[key].tiers.add(event.tier);
  }

  return summary;
}
