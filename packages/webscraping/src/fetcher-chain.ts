/**
 * fetcher-chain.ts — Multi-tier fallback fetcher.
 *
 * Tiers (tried in order):
 *   1.  HTTP       — native Node fetch (fast, no stealth)
 *   2.  Stealthy   — Scrapling FetcherSession via Python bridge (TLS impersonation)
 *   3.  Dynamic    — Scrapling DynamicSession via Python bridge (Playwright headless)
 *   4.  Chrome     — local Chrome via Puppeteer (puppeteer-core, full browser)
 *
 * Each tier is attempted only after the previous tier fails. "Failure" means
 * a thrown error, a non-2xx status from an anti-bot page, or a timeout.
 * Successful responses are returned immediately.
 */

import { bridgeCall } from "./python-bridge.js";
import { loadSession, updateSession } from "./session-manager.js";
import type {
  FetchOptions,
  FetchResult,
  FetcherTier,
  SessionState,
} from "./types.js";

// ---------------------------------------------------------------------------
// Tier 1 — native HTTP
// ---------------------------------------------------------------------------

const BOT_DETECTION_SIGNALS = [
  /cloudflare/i,
  /captcha/i,
  /challenge/i,
  /just a moment/i,
  /enable javascript/i,
  /checking your browser/i,
  /ddos protection/i,
  /attention required/i,
];

function _looksLikeAntiBot(body: string, status: number): boolean {
  if (status === 403 || status === 503) return true;
  return BOT_DETECTION_SIGNALS.some((re) => re.test(body.slice(0, 2000)));
}

async function _tierHttp(opts: FetchOptions): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 30_000,
  );

  try {
    const resp = await fetch(opts.url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
    });

    const body = await resp.text();
    const finalUrl = resp.url;

    if (_looksLikeAntiBot(body, resp.status)) {
      throw new Error(`Anti-bot page detected (status ${resp.status})`);
    }

    return {
      status: resp.status,
      headers: Object.fromEntries(resp.headers.entries()),
      body,
      finalUrl,
      tier: "http",
      elapsedMs: 0, // filled by caller
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — Scrapling StealthyFetcher (Python bridge)
// ---------------------------------------------------------------------------

async function _tierStealthy(
  opts: FetchOptions,
  session?: SessionState | null,
): Promise<FetchResult> {
  const headers = { ...opts.headers };
  if (session?.headers) {
    for (const [k, v] of Object.entries(session.headers)) {
      if (!headers[k]) headers[k] = v;
    }
  }

  const resp = await bridgeCall({
    action: "fetch_stealthy",
    url: opts.url,
    method: opts.method,
    headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes ?? 10_000_000,
  });

  if (!resp.success) {
    throw new Error(`Stealthy fetch failed: ${resp.error}`);
  }

  if (resp.status != null && _looksLikeAntiBot(resp.body ?? "", resp.status)) {
    throw new Error(`Stealthy anti-bot page (status ${resp.status})`);
  }

  return {
    status: resp.status ?? 0,
    headers: resp.headers ?? {},
    body: resp.body ?? "",
    finalUrl: resp.finalUrl ?? opts.url,
    tier: "stealthy",
    elapsedMs: resp.elapsedMs ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Tier 3 — Scrapling DynamicFetcher (Playwright via Python bridge)
// ---------------------------------------------------------------------------

async function _tierDynamic(
  opts: FetchOptions,
  session?: SessionState | null,
): Promise<FetchResult> {
  const headers = { ...opts.headers };
  if (session?.headers) {
    for (const [k, v] of Object.entries(session.headers)) {
      if (!headers[k]) headers[k] = v;
    }
  }

  const resp = await bridgeCall({
    action: "fetch_dynamic",
    url: opts.url,
    method: opts.method,
    headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes ?? 10_000_000,
  });

  if (!resp.success) {
    throw new Error(`Dynamic fetch failed: ${resp.error}`);
  }

  return {
    status: resp.status ?? 0,
    headers: resp.headers ?? {},
    body: resp.body ?? "",
    finalUrl: resp.finalUrl ?? opts.url,
    tier: "dynamic",
    elapsedMs: resp.elapsedMs ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Tier 4 — Local Chrome via Puppeteer (puppeteer-core)
// ---------------------------------------------------------------------------

async function _tierChrome(
  opts: FetchOptions,
  session?: SessionState | null,
): Promise<FetchResult> {
  // Dynamic import so the package is only required when this tier is hit.
  const puppeteer = await import("puppeteer-core");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Restore cookies from session
    if (session?.cookies) {
      const cookieEntries = Object.entries(session.cookies).map(([name, value]) => ({
        name,
        value,
        domain: new URL(opts.url).hostname,
        path: "/",
      }));
      if (cookieEntries.length > 0) {
        await page.setCookie(...cookieEntries);
      }
    }

    if (opts.headers) {
      await page.setExtraHTTPHeaders(opts.headers);
    }

    const response = await page.goto(opts.url, {
      waitUntil: "networkidle2",
      timeout: opts.timeoutMs ?? 60_000,
    });

    const status = response?.status() ?? 0;
    const headers = response?.headers() ?? {};
    const body = await page.content();
    const finalUrl = page.url();

    // Extract cookies for session persistence
    const puppeteerCookies = await page.cookies();
    const cookies: Record<string, string> = {};
    for (const c of puppeteerCookies) {
      cookies[c.name] = c.value;
    }

    // Persist session
    await updateSession(new URL(opts.url).hostname, {
      cookies,
      lastSuccessfulTier: "chrome",
    });

    return {
      status,
      headers: headers as Record<string, string>,
      body,
      finalUrl,
      tier: "chrome",
      elapsedMs: 0,
    };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Tier registry
// ---------------------------------------------------------------------------

/** A tier handler plus a short label. */
interface Tier {
  name: FetcherTier;
  fn: (opts: FetchOptions, session?: SessionState | null) => Promise<FetchResult>;
}

const ALL_TIERS: Tier[] = [
  { name: "http", fn: _tierHttp },
  { name: "stealthy", fn: _tierStealthy },
  { name: "dynamic", fn: _tierDynamic },
  { name: "chrome", fn: _tierChrome },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a URL through the multi-tier fallback chain.
 *
 * Starts at the tier specified in `opts.startTier` (defaults to "http") and
 * falls through to heavier tiers on failure. Returns the first successful
 * result or throws if every tier fails.
 *
 * Session state (cookies, headers, last successful tier) is persisted
 * automatically so subsequent fetches to the same domain use the best tier.
 */
export async function fetchWithFallback(
  opts: FetchOptions,
): Promise<FetchResult> {
  const domain = new URL(opts.url).hostname;
  const startTier: FetcherTier = opts.startTier ?? "http";

  // When respectTos is true, skip the StealthyFetcher tier (TLS impersonation
  // may violate site ToS).  The HTTP, Dynamic, and Chrome tiers use real
  // browser fingerprints and are always safe.
  const respectTos = opts.respectTos ?? true;
  const availableTiers = respectTos
    ? ALL_TIERS.filter((t) => t.name !== "stealthy")
    : ALL_TIERS;

  // Load persisted session for cookies / header continuity.
  const session = await loadSession(domain);

  // If a prior session recorded a successful tier, try that first (unless
  // the caller explicitly asked to start somewhere else, or respectTos
  // prevents starting at the stealthy tier).
  let effectiveStart = startTier;
  if (
    startTier === "http" &&
    session?.lastSuccessfulTier &&
    session.lastSuccessfulTier !== "http"
  ) {
    // Don't inherit a stealthy start tier when respectTos is true.
    if (!(respectTos && session.lastSuccessfulTier === "stealthy")) {
      effectiveStart = session.lastSuccessfulTier;
    }
  }

  // Build the tier list starting from `effectiveStart`, using only the
  // tiers available under the current respectTos policy.
  const startIdx = availableTiers.findIndex(
    (t) => t.name === effectiveStart,
  );
  const tiers =
    startIdx >= 0 ? availableTiers.slice(startIdx) : availableTiers;

  const errors: string[] = [];
  const overallStart = Date.now();

  for (const tier of tiers) {
    const tierStart = Date.now();
    try {
      const result = await tier.fn(opts, session);
      result.elapsedMs = Date.now() - tierStart;

      // Persist the successful tier for this domain.
      await updateSession(domain, {
        cookies: _extractCookies(result.headers),
        headers: _captureRelevantHeaders(result.headers),
        lastSuccessfulTier: tier.name,
      });

      result.elapsedMs = Date.now() - overallStart;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${tier.name}] ${msg}`);
    }
  }

  throw new Error(
    `All fetch tiers failed for ${opts.url}:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _extractCookies(headers: Record<string, string>): Record<string, string> {
  const setCookie = headers["set-cookie"];
  if (!setCookie) return {};

  const cookies: Record<string, string> = {};
  // Handle both single string and array (Puppeteer returns array)
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      const semi = part.indexOf(";", eq);
      const name = part.slice(0, eq).trim();
      const value =
        semi > eq ? part.slice(eq + 1, semi) : part.slice(eq + 1);
      cookies[name] = value.trim();
    }
  }
  return cookies;
}

function _captureRelevantHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const relevant = new Set([
    "user-agent",
    "accept",
    "accept-language",
    "accept-encoding",
  ]);
  const captured: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (relevant.has(k.toLowerCase())) {
      captured[k] = v;
    }
  }
  return captured;
}
