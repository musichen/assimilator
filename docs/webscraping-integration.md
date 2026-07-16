# Webscraping Integration

The `@assimilator/webscraping` package provides a multi-tier fallback fetcher that handles sites with anti-bot protections (Cloudflare, DataDome, LinkedIn, etc.). It is wired into the CLI converter pipeline as a fallback layer for difficult sites.

## Architecture

The fetcher chain has 4 tiers, tried in order:

```
Tier 1: HTTP       → Native Node fetch (fast, no stealth)
Tier 2: Stealthy   → Scrapling FetcherSession via Python bridge (TLS impersonation)
Tier 3: Dynamic    → Scrapling DynamicSession via Python bridge (Playwright headless)
Tier 4: Chrome     → Local Chrome via Puppeteer (puppeteer-core, full browser)
```

Each tier is attempted only after the previous fails. "Failure" means a thrown error, a non-2xx status from an anti-bot page, or a timeout. Successful responses are returned immediately.

## Multi-Tier Fallback Flow

```
fetchWithFallback(url)
  → Load persisted session for domain
  → If session recorded a successful tier, start there
  → Tier 1: HTTP (native fetch)
    → Success? Return immediately
    → Anti-bot detected / timeout? Fall through
  → Tier 2: Stealthy (Scrapling TLS impersonation)
    → Success? Return immediately
    → Failed? Fall through
  → Tier 3: Dynamic (Scrapling Playwright headless)
    → Success? Return immediately
    → Failed? Fall through
  → Tier 4: Chrome (puppeteer-core)
    → Success? Return with persisted session
    → Failed? Throw — all tiers exhausted
```

## Adaptive Parser

When site layouts change and CSS/XPath selectors break, the adaptive parser can relocate selectors by comparing old and new HTML snapshots via structural similarity:

- `relocateSelector(oldHtml, newHtml, selector)` — find the closest structural match
- `relocateWithRetry(url, selector, maxRetries)` — re-fetch and try relocation if initial fetch fails
- `validateCssSelector(html, selector)` — check whether a selector still matches

This is exposed as a public API for downstream consumers but is not currently wired into the CLI conversion pipeline — it's intended for scraper maintenance scripts.

## Anti-Bot Detection

The `detectProtection(body, status, headers)` function scans responses for known anti-bot / WAF signatures:

| Protection Type | Detection Method |
|---|---|
| `cloudflare-turnstile` | Body contains turnstile widget, status 403/429 |
| `cloudflare-interstitial` | Body contains "Checking your browser" / "Just a moment", `cf-ray` header |
| `cloudflare-challenge` | Body references `cURL`/`jschl` challenge logic |
| `cloudflare-js-challenge` | Body contains `jschl-answer` |
| `datadome` | Header `x-datadome` or `x-datadome-clientid` |
| `akamai` | Body contains `akam` domain references |
| `imperva` | Body contains `_Incapsula_Resource` |
| `sucuri` | Body contains `Sucuri CloudProxy` |
| `generic-captcha` | Body contains captcha/recaptcha/hcaptcha references |
| `generic-block` | Body contains block/access denied, status 403/429 |

Detection events are logged with `logProtectionEvent()` and can be queried with `getProtectionEvents()` / `queryProtectionEvents()` for diagnostics.

## Session Manager

Session state (cookies, headers, last successful tier) is persisted per-domain. When a Chrome-tier fetch succeeds, cookies are extracted from Puppeteer and saved. Subsequent fetches to the same domain automatically restore session state and skip straight to the tier that worked last time.

Session persistence uses a file-based store (JSON files under a configurable directory). The store directory defaults to a temp location; call `setStoreDir(path)` to pin it.

## Python Bridge

Tiers 2 and 3 communicate with Scrapling (a Python scraping library) via a JSON-RPC bridge over stdin/stdout. The bridge process (`packages/webscraping/python/scrapling_bridge.py`) is spawned once and reused across fetches.

**Prerequisites:**

```bash
# The project-installed Python environment must include scrapling
pip install "scrapling[fetchers]"
```

The bridge health can be checked at runtime via `bridgeHealth()`.

## CLI Integration

The webscraping converter is wired into `apps/cli/src/converters/remote-converter.ts` in two places:

### 1. LinkedIn fallback

```
LinkedIn URL detected
  → Puppeteer extraction (linkedin.ts)
    → Success? Return markdown
    → Failed? Fall through
  → Webscraping multi-tier chain (webscraping.ts)
    → Success? Return markdown
    → Failed? Fall through to generic converters
```

### 2. Difficult site primary

For URLs matching `isDifficultSite()` (LinkedIn, Glassdoor, Indeed, Instagram, TikTok, Twitter/X, CrunchBase, PitchBook, ZoomInfo):

```
Difficult site URL detected
  → Webscraping multi-tier chain (webscraping.ts)
    → Success? Return markdown
    → Failed? Fall through to generic converters (markit-ai → markitdown)
```

### 3. Generic URL pipeline (unchanged)

For all other URLs, the pipeline remains: markit-ai → markitdown.

## Difficult Domain List

The `isDifficultSite(url)` function checks against a hardcoded set of domains known to require browser-level rendering or anti-bot bypass:

- `linkedin.com`
- `glassdoor.com`
- `indeed.com`
- `instagram.com`
- `tiktok.com`
- `twitter.com` / `x.com`
- `crunchbase.com`
- `pitchbook.com`
- `zoominfo.com`

To add a new domain, edit the `DIFFICULT_DOMAINS` set in `apps/cli/src/converters/webscraping.ts`.

## Package Structure

```
packages/webscraping/
  src/
    index.ts              # Public API surface
    fetcher-chain.ts      # Multi-tier fallback (HTTP → Stealthy → Dynamic → Chrome)
    python-bridge.ts      # JSON-RPC bridge to Scrapling Python process
    adaptive-parser.ts    # Selector relocation via structural similarity
    anti-bot.ts           # Protection detection + event logging
    session-manager.ts    # Domain session persistence (cookies, headers)
    spider-runner.ts      # Crawl scheduling + MCP adapter
    types.ts              # Shared TypeScript types
  python/
    scrapling_bridge.py   # Python JSON-RPC server (Scrapling integration)
```

## Dependencies

- **Node**: `puppeteer-core` (Tier 4 Chrome browser)
- **Python**: `scrapling[fetchers]` (Tiers 2 & 3 via Python bridge)
- **Native**: Chrome/Chromium installed and discoverable by Puppeteer

The webscraping package is an Assimilator workspace dependency (`@assimilator/webscraping: workspace:*`) used by `@assimilator/cli`.

## Health Check

The bridge health can be checked:

```ts
import { bridgeHealth } from "@assimilator/webscraping";
const alive = await bridgeHealth(); // true if Python bridge + Scrapling are functional
```

## Error Handling

If all fetch tiers fail, `fetchWithFallback` throws with a message listing each tier's error. The CLI converter catches this and falls through to generic converters (markit-ai → markitdown), ensuring the pipeline never dead-ends on a single failed approach.

## --respect-tos Flag

The `--respect-tos` flag (default: `true`) disables the StealthyFetcher tier (Tier 2) out of respect for websites' Terms of Service. TLS impersonation can be considered a ToS violation; when `respectTos` is `true`, the fetcher chain only uses tiers that employ real browser fingerprints:

- **HTTP** (Tier 1) — standard Node `fetch`, no impersonation
- **Dynamic** (Tier 3) — Playwright headless (real browser fingerprint)
- **Chrome** (Tier 4) — puppeteer-core (real browser fingerprint)

```ts
// Default: StealthyFetcher disabled
await fetchWithFallback({ url: "https://example.com" });
// → Tiers: HTTP → Dynamic → Chrome

// Explicit: allow StealthyFetcher
await fetchWithFallback({
  url: "https://example.com",
  respectTos: false,
});
// → Tiers: HTTP → Stealthy → Dynamic → Chrome
```

From the CLI, pass via the converter:

```ts
await convertDifficultSite(url, onProgress, /* respectTos */ true);
```

When `respectTos` is `true` and a previous session recorded `stealthy` as the last successful tier, the session tier hint is ignored and the chain starts from HTTP instead — the session won't quietly re-enable a disabled tier.

## Worked Example: LinkedIn Post

This is the scenario that motivated the package. A LinkedIn activity post (`urn:li:activity:...`) is auth-gated — no public API, no open subtitle track, and the page returns a login wall for unauthenticated requests.

### Without the fallback chain

```ts
// Plain HTTP fetch
const resp = await fetch(
  "https://www.linkedin.com/feed/update/urn:li:activity:7468591569831411712"
);
// → 307 redirect to /signup/cold-join
// → Login required — no content extracted
```

### With the fallback chain

```ts
import { fetchWithFallback } from "@assimilator/webscraping";

const result = await fetchWithFallback({
  url: "https://www.linkedin.com/feed/update/urn:li:activity:7468591569831411712",
  timeoutMs: 60_000,
});
```

**Tier 1 (HTTP):** 307 redirect → login wall. **Escalating.**  
**Tier 2 (Stealthy, if `respectTos: false`):** 307 redirect → login wall (no cookies). **Escalating.**  
**Tier 3 (Dynamic — Playwright):** Loads page but shows login wall. **Escalating.**  
**Tier 4 (Chrome — puppeteer-core):** Uses the user's Chrome profile (if `LINKEDIN_USER_DATA_DIR` is set in the converter wrapper) or Puppeteer's fresh context. If the user has an active LinkedIn session, cookies are restored via the session manager, the post loads, and the adaptive parser extracts: post text, author, reactions, and any embedded media references.

```ts
console.log(result.tier);          // "chrome"
console.log(result.status);        // 200
console.log(result.body.length);   // ~150KB (full page HTML)
console.log(result.finalUrl);      // the canonical activity URL
```

The raw HTML is then passed through the existing MarkItDown/markit-ai pipeline for final markdown conversion. The webscraping package solves the *access* problem; downstream converters handle the *formatting*.

### Session persistence

After a successful Chrome-tier fetch, LinkedIn cookies (`li_at`, `JSESSIONID`, etc.) are persisted via the session manager. Subsequent fetches to `linkedin.com` skip straight to the Chrome tier:

```ts
// First fetch — expensive (launches browser, navigates, extracts cookies)
await fetchWithFallback({ url: "https://www.linkedin.com/feed/..." });
// → 4 seconds, tier "chrome"

// Second fetch — fast (session cookies restored)
await fetchWithFallback({ url: "https://www.linkedin.com/feed/..." });
// → 2 seconds, tier "chrome" (starts at last successful tier)
```
