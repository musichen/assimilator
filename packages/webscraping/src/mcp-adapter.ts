/**
 * mcp-adapter.ts — MCP stdio server that exposes the webscraping package's
 * capabilities as MCP tools.
 *
 * Spawned as a child process by Hermes' MCP client. Communicates via
 * JSON-RPC over stdin/stdout (one JSON object per line).
 *
 * Registered tools:
 *   webscrape_fetch             — Fetch a single URL through the tier chain.
 *   webscrape_crawl_start       — Start a new crawl with pause/resume.
 *   webscrape_crawl_pause       — Pause a running crawl.
 *   webscrape_crawl_resume      — Resume a paused crawl.
 *   webscrape_crawl_cancel      — Cancel a crawl.
 *   webscrape_crawl_status      — Get status of a crawl.
 *   webscrape_crawl_list        — List all crawls.
 *   webscrape_detect_protection — Detect anti-bot protections on a response.
 *   webscrape_relocate_selector — Auto-relocate a broken CSS/XPath selector.
 */

import { createInterface } from "node:readline";

import { detectProtection } from "./anti-bot.js";
import { relocateSelector } from "./adaptive-parser.js";
import { fetchWithFallback } from "./fetcher-chain.js";
import { bridgeHealth } from "./python-bridge.js";
import {
  cancelCrawl,
  getCrawlState,
  listCrawls,
  pauseCrawl,
  resumeCrawl,
  startCrawl,
} from "./spider-runner.js";
import type {
  CrawlState as SpiderCrawlState,
  CrawlConfig as SpiderCrawlConfig,
  CrawlScope,
} from "./spider-runner.js";
import type { FetchOptions, FetcherTier } from "./types.js";

// ---------------------------------------------------------------------------
// MCP protocol types (subset of the spec)
// ---------------------------------------------------------------------------

interface MCPRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: MCPToolDef[] = [
  {
    name: "webscrape_fetch",
    description:
      "Fetch a single URL through the multi-tier fetcher chain (HTTP → Stealthy → Dynamic → Chrome). Returns the page content, headers, status, and which tier succeeded.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          description: "HTTP method (default GET).",
        },
        headers: {
          type: "object",
          description: "Optional request headers.",
        },
        body: {
          type: "string",
          description: "Request body for POST/PUT.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default 30000).",
        },
        startTier: {
          type: "string",
          enum: ["http", "stealthy", "dynamic", "chrome"],
          description: "Which tier to start at (default 'http').",
        },
        maxBytes: {
          type: "number",
          description: "Truncate response body after this many bytes.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "webscrape_crawl_start",
    description:
      "Start a new crawl job with configurable depth, concurrency, and domain scoping. Returns a crawl ID. The crawl runs in the background with pause/resume support.",
    inputSchema: {
      type: "object",
      properties: {
        startUrls: {
          type: "array",
          items: { type: "string" },
          description: "Seed URLs to start crawling from.",
        },
        maxDepth: {
          type: "number",
          description: "Maximum link depth from seed URLs (default 3).",
        },
        maxPages: {
          type: "number",
          description: "Maximum pages to fetch (default 500).",
        },
        concurrency: {
          type: "number",
          description: "Maximum concurrent fetches (default 3).",
        },
        requestDelayMs: {
          type: "number",
          description: "Minimum delay between fetches to the same domain in ms (default 1000).",
        },
        scope: {
          type: "object",
          description: "Domain/path/pattern scoping rules.",
          properties: {
            allowedDomains: {
              type: "array",
              items: { type: "string" },
              description: "Only follow links whose hostname matches.",
            },
            includePatterns: {
              type: "array",
              items: { type: "string" },
              description: "Regex patterns a URL must match.",
            },
            excludePatterns: {
              type: "array",
              items: { type: "string" },
              description: "Regex patterns a URL must NOT match.",
            },
            pathPrefixes: {
              type: "array",
              items: { type: "string" },
              description: "Path prefixes to restrict crawling to.",
            },
          },
        },
        userAgent: {
          type: "string",
          description: "Custom User-Agent sent with every request.",
        },
      },
      required: ["startUrls"],
    },
  },
  {
    name: "webscrape_crawl_pause",
    description: "Pause a running crawl. In-flight pages finish; state is persisted.",
    inputSchema: {
      type: "object",
      properties: {
        crawlId: {
          type: "string",
          description: "The crawl ID returned by webscrape_crawl_start.",
        },
      },
      required: ["crawlId"],
    },
  },
  {
    name: "webscrape_crawl_resume",
    description: "Resume a previously paused crawl.",
    inputSchema: {
      type: "object",
      properties: {
        crawlId: {
          type: "string",
          description: "The crawl ID returned by webscrape_crawl_start.",
        },
      },
      required: ["crawlId"],
    },
  },
  {
    name: "webscrape_crawl_cancel",
    description: "Cancel a running or paused crawl and remove its state.",
    inputSchema: {
      type: "object",
      properties: {
        crawlId: {
          type: "string",
          description: "The crawl ID returned by webscrape_crawl_start.",
        },
      },
      required: ["crawlId"],
    },
  },
  {
    name: "webscrape_crawl_status",
    description:
      "Get the current state of a crawl including stats, queue size, and recent results.",
    inputSchema: {
      type: "object",
      properties: {
        crawlId: {
          type: "string",
          description: "The crawl ID returned by webscrape_crawl_start.",
        },
      },
      required: ["crawlId"],
    },
  },
  {
    name: "webscrape_crawl_list",
    description: "List all crawls (active, paused, completed).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "webscrape_detect_protection",
    description:
      "Scan a response body + headers for anti-bot / WAF protection signals (Cloudflare, DataDome, Akamai, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        body: {
          type: "string",
          description: "The response body (HTML) to scan.",
        },
        status: {
          type: "number",
          description: "HTTP status code of the response.",
        },
        headers: {
          type: "object",
          description: "Response headers (key → value).",
        },
      },
      required: ["body", "status", "headers"],
    },
  },
  {
    name: "webscrape_relocate_selector",
    description:
      "When a CSS selector stopped working because the site changed its DOM, find the most similar element in a new page using Scrapling's structural similarity engine.",
    inputSchema: {
      type: "object",
      properties: {
        oldHtml: {
          type: "string",
          description: "The cached (old) HTML snapshot where the selector worked.",
        },
        newHtml: {
          type: "string",
          description: "The newly-fetched HTML where the selector no longer matches.",
        },
        selector: {
          type: "string",
          description: "The CSS selector (or XPath) to relocate.",
        },
        selectorType: {
          type: "string",
          enum: ["css", "xpath"],
          description: "Whether `selector` is a CSS or XPath expression (default 'css').",
        },
      },
      required: ["oldHtml", "newHtml", "selector"],
    },
  },
  {
    name: "webscrape_health",
    description:
      "Check whether the Python bridge (Scrapling) is alive and healthy.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function _handleFetch(
  params: Record<string, unknown>,
): Promise<unknown> {
  const opts: FetchOptions = {
    url: params.url as string,
    method: (params.method as FetchOptions["method"]) ?? "GET",
    headers: params.headers as Record<string, string> | undefined,
    body: params.body as string | undefined,
    timeoutMs: params.timeoutMs as number | undefined,
    startTier: params.startTier as FetcherTier | undefined,
    maxBytes: params.maxBytes as number | undefined,
  };

  const result = await fetchWithFallback(opts);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

async function _handleCrawlStart(
  params: Record<string, unknown>,
): Promise<unknown> {
  const config: SpiderCrawlConfig = {
    startUrls: params.startUrls as string[],
    maxDepth: params.maxDepth as number | undefined,
    maxPages: params.maxPages as number | undefined,
    concurrency: params.concurrency as number | undefined,
    requestDelayMs: params.requestDelayMs as number | undefined,
    userAgent: params.userAgent as string | undefined,
  };

  if (params.scope) {
    const scopeRaw = params.scope as Record<string, unknown>;
    const scope: CrawlScope = {};
    if (scopeRaw.allowedDomains) {
      scope.allowedDomains = scopeRaw.allowedDomains as string[];
    }
    if (scopeRaw.includePatterns) {
      scope.includePatterns = scopeRaw.includePatterns as string[];
    }
    if (scopeRaw.excludePatterns) {
      scope.excludePatterns = scopeRaw.excludePatterns as string[];
    }
    if (scopeRaw.pathPrefixes) {
      scope.pathPrefixes = scopeRaw.pathPrefixes as string[];
    }
    config.scope = scope;
  }

  const crawlId = await startCrawl(config);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ crawlId, message: "Crawl started" }),
      },
    ],
  };
}

async function _handleCrawlPause(
  params: Record<string, unknown>,
): Promise<unknown> {
  const crawlId = params.crawlId as string;
  await pauseCrawl(crawlId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ crawlId, status: "paused" }),
      },
    ],
  };
}

async function _handleCrawlResume(
  params: Record<string, unknown>,
): Promise<unknown> {
  const crawlId = params.crawlId as string;
  await resumeCrawl(crawlId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ crawlId, status: "resumed" }),
      },
    ],
  };
}

async function _handleCrawlCancel(
  params: Record<string, unknown>,
): Promise<unknown> {
  const crawlId = params.crawlId as string;
  await cancelCrawl(crawlId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ crawlId, status: "cancelled" }),
      },
    ],
  };
}

async function _handleCrawlStatus(
  params: Record<string, unknown>,
): Promise<unknown> {
  const crawlId = params.crawlId as string;
  const state = await getCrawlState(crawlId);

  if (!state) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Crawl ${crawlId} not found` }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(state, null, 2),
      },
    ],
  };
}

async function _handleCrawlList(): Promise<unknown> {
  const crawls = await listCrawls();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(crawls, null, 2),
      },
    ],
  };
}

async function _handleDetectProtection(
  params: Record<string, unknown>,
): Promise<unknown> {
  const body = params.body as string;
  const status = params.status as number;
  const headers = params.headers as Record<string, string>;

  const result = detectProtection(body, status, headers);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

async function _handleRelocateSelector(
  params: Record<string, unknown>,
): Promise<unknown> {
  const oldHtml = params.oldHtml as string;
  const newHtml = params.newHtml as string;
  const selector = params.selector as string;
  const selectorType = (params.selectorType as string) ?? "css";

  const result = await relocateSelector(
    oldHtml,
    newHtml,
    selector,
    selectorType as "css" | "xpath",
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

async function _handleHealth(): Promise<unknown> {
  const healthy = await bridgeHealth();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          healthy,
          message: healthy
            ? "Python bridge (Scrapling) is alive"
            : "Python bridge (Scrapling) is not responding",
        }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

async function _handleRequest(req: MCPRequest): Promise<MCPResponse | null> {
  const { id, method, params } = req;

  // Notifications (no id) — no response.
  if (id === undefined) {
    if (method === "notifications/initialized") {
      // Acknowledge silently.
      return null;
    }
    return null;
  }

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "@assimilator/webscraping-mcp",
              version: "0.1.0",
            },
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: TOOLS },
        };

      case "tools/call": {
        const toolName = (params as Record<string, unknown>)
          ?.name as string;
        const toolParams = ((params as Record<string, unknown>)
          ?.arguments ?? {}) as Record<string, unknown>;

        let result: unknown;

        switch (toolName) {
          case "webscrape_fetch":
            result = await _handleFetch(toolParams);
            break;
          case "webscrape_crawl_start":
            result = await _handleCrawlStart(toolParams);
            break;
          case "webscrape_crawl_pause":
            result = await _handleCrawlPause(toolParams);
            break;
          case "webscrape_crawl_resume":
            result = await _handleCrawlResume(toolParams);
            break;
          case "webscrape_crawl_cancel":
            result = await _handleCrawlCancel(toolParams);
            break;
          case "webscrape_crawl_status":
            result = await _handleCrawlStatus(toolParams);
            break;
          case "webscrape_crawl_list":
            result = await _handleCrawlList();
            break;
          case "webscrape_detect_protection":
            result = await _handleDetectProtection(toolParams);
            break;
          case "webscrape_relocate_selector":
            result = await _handleRelocateSelector(toolParams);
            break;
          case "webscrape_health":
            result = await _handleHealth();
            break;
          default:
            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32601,
                message: `Unknown tool: ${toolName}`,
              },
            };
        }

        return {
          jsonrpc: "2.0",
          id,
          result,
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown method: ${method}`,
          },
        };
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Main — stdin/stdout JSON-RPC loop
// ---------------------------------------------------------------------------

function main(): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: MCPRequest;
    try {
      req = JSON.parse(trimmed) as MCPRequest;
    } catch {
      // Malformed line — per MCP spec, don't respond.
      return;
    }

    const resp = await _handleRequest(req);
    if (resp) {
      process.stdout.write(JSON.stringify(resp) + "\n");
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main();
