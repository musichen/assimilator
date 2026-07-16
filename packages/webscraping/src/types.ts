/**
 * Shared types for the webscraping package.
 */

/** Which tier in the fetcher chain produced the result. */
export type FetcherTier = "http" | "stealthy" | "dynamic" | "chrome";

/** Authentication credentials optionally attached to a fetch request. */
export interface FetchAuth {
  username: string;
  password: string;
}

/** Options for a single fetch request. */
export interface FetchOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  /** Max milliseconds before the request times out. */
  timeoutMs?: number;
  /** Which tier to start at (defaults to "http"). */
  startTier?: FetcherTier;
  /** Stop after this many bytes (avoids downloading huge files). */
  maxBytes?: number;
  /** Basic / digest auth. */
  auth?: FetchAuth;
  /**
   * When true (default), the StealthyFetcher tier is skipped out of
   * respect for sites' Terms of Service.  Only the HTTP, Dynamic
   * (Playwright), and Chrome tiers are used.
   */
  respectTos?: boolean;
}

/** The result of a fetch, regardless of which tier produced it. */
export interface FetchResult {
  /** HTTP status code. 0 when the transport itself failed (e.g. timeout). */
  status: number;
  /** Response headers. */
  headers: Record<string, string>;
  /** Response body as UTF-8 text. */
  body: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** Which tier ultimately satisfied the request. */
  tier: FetcherTier;
  /** Wall-clock duration of the winning fetch attempt (ms). */
  elapsedMs: number;
}

/** Persisted session state for a single domain. */
export interface SessionState {
  domain: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string;
  /** The last tier that was used successfully for this domain (hint for next fetch). */
  lastSuccessfulTier?: FetcherTier;
}

/** Shape of the JSON-RPC message going from TS → Python. */
export interface PythonBridgeRequest {
  action: "fetch_stealthy" | "fetch_dynamic" | "health" | "find_similar";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** find_similar action: reference (old) HTML document. */
  oldHtml?: string;
  /** find_similar action: changed (new) HTML document. */
  newHtml?: string;
  /** find_similar action: the selector / XPath that stopped working. */
  selector?: string;
  /** find_similar action: \"css\" (default) or \"xpath\". */
  selectorType?: "css" | "xpath";
}

/** Shape of the JSON-RPC response coming from Python → TS. */
export interface PythonBridgeResponse {
  success: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  finalUrl?: string;
  elapsedMs?: number;
  error?: string;
  /** find_similar action: relocated CSS selector. */
  css?: string;
  /** find_similar action: relocated XPath expression. */
  xpath?: string;
  /** find_similar action: similarity confidence 0-1. */
  confidence?: number;
}

/** Known anti-bot / WAF protection types. */
export type ProtectionType =
  | "cloudflare-turnstile"
  | "cloudflare-interstitial"
  | "cloudflare-challenge"
  | "cloudflare-js-challenge"
  | "datadome"
  | "akamai"
  | "imperva"
  | "sucuri"
  | "generic-captcha"
  | "generic-block"
  | "unknown";

/** Structured record of an anti-bot protection page being encountered. */
export interface ProtectionEvent {
  url: string;
  tier: FetcherTier;
  protection: ProtectionType;
  statusCode: number;
  /** ISO-8601 timestamp of detection. */
  detectedAt: string;
  headers: Record<string, string>;
  /** First ~200 chars of the response body (diagnostic snippet). */
  snippet: string;
}

/** Result of scanning a response for anti-bot signals. */
export interface ProtectionDetection {
  detected: boolean;
  type: ProtectionType;
  confidence: "high" | "medium" | "low";
  details: string;
}

/** Result of a similarity-based selector relocation. */
export interface SelectorRelocation {
  css: string;
  xpath: string;
  /** Similarity confidence 0-1; 1.0 = exact structural match. */
  confidence: number;
}
