/**
 * adaptive-parser.ts — Selector auto-relocation via Scrapling's similarity
 * algorithm over the Python bridge.
 *
 * When a page's DOM structure changes and a saved CSS/XPath selector stops
 * matching, this module re-fetches the page and uses Scrapling's Adaptor
 * (similarity matching) to find the best-matching element in the new version.
 *
 * Workflow:
 *   1. Parse old HTML with the (now-broken) selector to extract the target
 *      element's structural signature.
 *   2. Pass old HTML, new HTML, and the broken selector to the Python bridge
 *      under action `find_similar`.
 *   3. Scrapling's Adaptor returns a relocated CSS + XPath selector with a
 *      confidence score (0–1).
 *   4. The caller can validate the relocated selector by running a query
 *      against the new document and checking whether the result passes a
 *      similarity threshold.
 */

import { bridgeCall } from "./python-bridge.js";
import type {
  FetchResult,
  PythonBridgeResponse,
  SelectorRelocation,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Relocate a selector that worked against `oldHtml` so it works against
 * `newHtml`.  Uses Scrapling's Adaptor similarity algorithm over the Python
 * bridge.
 *
 * @param oldHtml   - The HTML document where the selector is known to work.
 * @param newHtml   - The updated HTML document where the selector is broken.
 * @param selector  - The CSS selector or XPath expression to relocate.
 * @param selectorType - `"css"` (default) or `"xpath"`.
 *
 * @returns A `SelectorRelocation` with the new selector strings and
 *          confidence score.  On failure the promise rejects with an Error.
 */
export async function relocateSelector(
  oldHtml: string,
  newHtml: string,
  selector: string,
  selectorType: "css" | "xpath" = "css",
): Promise<SelectorRelocation> {
  const resp: PythonBridgeResponse = await bridgeCall({
    action: "find_similar",
    url: "", // not used for find_similar
    oldHtml,
    newHtml,
    selector,
    selectorType,
  });

  if (!resp.success) {
    throw new Error(
      `Selector relocation failed: ${resp.error ?? "unknown error"}`,
    );
  }

  return {
    css: resp.css ?? "",
    xpath: resp.xpath ?? "",
    confidence: resp.confidence ?? 0,
  };
}

/**
 * Relocate a selector using the body and finalUrl from two FetchResults.
 *
 * This is the ergonomic wrapper around `relocateSelector` that works directly
 * with the output of `fetchWithFallback` — useful when a page is re-fetched
 * after an older fetch and the caller discovers that a previously-working
 * selector no longer matches.
 *
 * @param oldResult — The older (working) fetch result.
 * @param newResult — The newer (potentially changed) fetch result.
 * @param selector  — The CSS selector or XPath expression that stopped
 *                    matching.
 * @param selectorType — `"css"` (default) or `"xpath"`.
 */
export async function relocateFromResults(
  oldResult: FetchResult,
  newResult: FetchResult,
  selector: string,
  selectorType: "css" | "xpath" = "css",
): Promise<SelectorRelocation> {
  return relocateSelector(
    oldResult.body,
    newResult.body,
    selector,
    selectorType,
  );
}

/**
 * Relocate a selector with retry: re-fetches `url` via a user-supplied fetch
 * function up to `maxRetries` times.  This handles the common case where a
 * page changes between two fetches — the selector breaks, so you re-fetch and
 * relocate.
 *
 * @param url       — The URL of the page.
 * @param oldHtml   — HTML from when the selector last worked.
 * @param selector  — The broken selector.
 * @param selectorType — `"css"` (default) or `"xpath"`.
 * @param fetchFn   — Function that returns a FetchResult for the given URL.
 * @param maxRetries — Maximum re-fetch attempts (default 2).
 *
 * @returns An object containing the relocated `SelectorRelocation` and the
 *          `FetchResult` from the successful re-fetch.
 */
export async function relocateWithRetry(
  url: string,
  oldHtml: string,
  selector: string,
  selectorType: "css" | "xpath",
  fetchFn: (url: string) => Promise<FetchResult>,
  maxRetries = 2,
): Promise<{ relocation: SelectorRelocation; result: FetchResult }> {
  const errors: string[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fetchFn(url);
      const relocation = await relocateSelector(
        oldHtml,
        result.body,
        selector,
        selectorType,
      );

      // Guard: if confidence is below a reasonable threshold the
      // relocation is probably wrong — try another re-fetch.
      if (relocation.confidence < 0.15) {
        errors.push(
          `Attempt ${attempt}: confidence too low (${relocation.confidence.toFixed(3)} < 0.15)`,
        );
        continue;
      }

      return { relocation, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Attempt ${attempt}: ${msg}`);
    }
  }

  throw new Error(
    `Selector relocation failed after ${maxRetries} retries:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  );
}

/**
 * Quick check: does the relocated CSS selector actually match elements in
 * `html`?  Returns the match count (0 means the relocation didn't work).
 *
 * Uses a lightweight regex-based tag-count instead of a full parser so callers
 * can cheaply gate before committing to the relocation.
 */
export function validateCssSelector(
  html: string,
  cssSelector: string,
): number {
  if (!cssSelector) return 0;

  // Simple tag extraction: if the selector starts with a tag name followed by
  // a class / id marker, count occurrences of that tag.
  const tagMatch = cssSelector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  if (!tagMatch || !tagMatch[1]) return 0;

  const tag = tagMatch[1].toLowerCase();

  // For selectors with an id, look for `id="X"` or `id='X'`.
  const idMatch = cssSelector.match(/#([^.#:[\] ]+)/);
  if (idMatch && idMatch[1]) {
    const idRe = new RegExp(
      `id=["']${_escapeRe(idMatch[1])}["']`,
      "gi",
    );
    const matches = html.match(idRe);
    return matches ? matches.length : 0;
  }

  // For selectors with a class, look for `class="...X..."` or standalone
  // class attribute containing the class.
  const classMatch = cssSelector.match(/\.([^.#:[\] ]+)/);
  if (classMatch && classMatch[1]) {
    const clsRe = new RegExp(
      `<${tag}[^>]*class=["'][^"']*\\b${_escapeRe(classMatch[1])}\\b[^"']*["']`,
      "gi",
    );
    const matches = html.match(clsRe);
    return matches ? matches.length : 0;
  }

  // Fallback: just count tag occurrences.
  const tagRe = new RegExp(`<${tag}[\\s>/]`, "gi");
  const matches = html.match(tagRe);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
