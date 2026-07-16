/**
 * @assimilator/webscraping — Public API surface.
 *
 * Usage:
 *   import { fetchWithFallback } from "@assimilator/webscraping";
 *
 *   const result = await fetchWithFallback({ url: "https://example.com" });
 */

export { fetchWithFallback } from "./fetcher-chain.js";
export {
  loadSession,
  saveSession,
  updateSession,
  deleteSession,
  setStoreDir,
} from "./session-manager.js";
export { bridgeCall, bridgeHealth, bridgeShutdown } from "./python-bridge.js";

// Spider runner
export {
  startCrawl,
  pauseCrawl,
  resumeCrawl,
  cancelCrawl,
  getCrawlState,
  listCrawls,
  extractLinks,
} from "./spider-runner.js";
export type {
  CrawlConfig,
  CrawlScope,
  CrawlState,
  CrawlStats,
  CrawlQueueEntry,
  CrawlPageResult,
  CrawlStatus,
} from "./spider-runner.js";

// Adaptive parser
export {
  relocateSelector,
  relocateFromResults,
  relocateWithRetry,
  validateCssSelector,
} from "./adaptive-parser.js";

// Anti-bot detection
export {
  detectProtection,
  detectFromResult,
  logProtectionEvent,
  getProtectionEvents,
  queryProtectionEvents,
  clearProtectionEvents,
  protectionSummary,
} from "./anti-bot.js";

export type * from "./types.js";
