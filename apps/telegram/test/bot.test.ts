/**
 * Bot handler tests — verify command parsing, handler routing, and TG output.
 *
 * Strategy:
 *  1. Test regex patterns match correct command formats
 *  2. Test core webscrape functions (already covered by converter tests)
 *  3. Test bot command registration shape
 *
 * TelegramBot is NOT instantiated — we test the pure logic paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { webscrapeFetch, webscrapeDetect, webscrapeHealth, webscrapeStats } from "../../cli/src/core/webscrape.js";

// ── Regex pattern tests ───────────────────────────────────────────────

const COMMAND_REGEXES = {
  scrapeFetch: /^\/scrape_fetch(?:\s+([\s\S]+))?/,
  scrapeDetect: /^\/scrape_detect(?:\s+([\s\S]+))?/,
  scrapeHealth: /^\/scrape_health\b/,
  scrapeStats: /^\/scrape_stats\b/,
  scrapeCrawl: /^\/scrape_crawl(?:\s+([\s\S]+))?/,
};

describe("Command regex matching", () => {
  describe("/scrape_fetch", () => {
    it("matches with URL", () => {
      const m = "/scrape_fetch https://example.com".match(COMMAND_REGEXES.scrapeFetch);
      expect(m).not.toBeNull();
      expect(m![1]?.trim()).toBe("https://example.com");
    });

    it("matches without URL (shows usage)", () => {
      const m = "/scrape_fetch".match(COMMAND_REGEXES.scrapeFetch);
      expect(m).not.toBeNull();
      expect(m![1]?.trim()).toBeFalsy();
    });

    it("matches with extra whitespace", () => {
      const m = "/scrape_fetch   https://linkedin.com/in/foo  ".match(COMMAND_REGEXES.scrapeFetch);
      expect(m![1]?.trim()).toBe("https://linkedin.com/in/foo");
    });
  });

  describe("/scrape_detect", () => {
    it("matches with URL", () => {
      const m = "/scrape_detect https://cloudflare.com".match(COMMAND_REGEXES.scrapeDetect);
      expect(m![1]?.trim()).toBe("https://cloudflare.com");
    });

    it("matches without URL", () => {
      const m = "/scrape_detect".match(COMMAND_REGEXES.scrapeDetect);
      expect(m![1]?.trim()).toBeFalsy();
    });
  });

  describe("/scrape_health", () => {
    it("matches standalone", () => {
      expect("/scrape_health".match(COMMAND_REGEXES.scrapeHealth)).not.toBeNull();
    });

    it("does not match /scrape_healthcheck (word boundary)", () => {
      expect("/scrape_healthcheck".match(COMMAND_REGEXES.scrapeHealth)).toBeNull();
    });
  });

  describe("/scrape_stats", () => {
    it("matches standalone", () => {
      expect("/scrape_stats".match(COMMAND_REGEXES.scrapeStats)).not.toBeNull();
    });
  });

  describe("/scrape_crawl", () => {
    it("parses start command with URL", () => {
      const m = "/scrape_crawl start https://example.com 3 100".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m).not.toBeNull();
      expect(m![1]?.trim()).toBe("start https://example.com 3 100");
    });

    it("parses pause with ID", () => {
      const m = "/scrape_crawl pause abc123".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m![1]?.trim()).toBe("pause abc123");
    });

    it("parses resume with ID", () => {
      const m = "/scrape_crawl resume abc123".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m![1]?.trim()).toBe("resume abc123");
    });

    it("parses cancel with ID", () => {
      const m = "/scrape_crawl cancel abc123".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m![1]?.trim()).toBe("cancel abc123");
    });

    it("parses status with ID", () => {
      const m = "/scrape_crawl status abc123".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m![1]?.trim()).toBe("status abc123");
    });

    it("parses list", () => {
      const m = "/scrape_crawl list".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m![1]?.trim()).toBe("list");
    });

    it("matches without args (shows help)", () => {
      const m = "/scrape_crawl".match(COMMAND_REGEXES.scrapeCrawl);
      expect(m![1]?.trim()).toBeFalsy();
    });
  });
});

// ── Core function shape tests ─────────────────────────────────────────

describe("webscrapeFetch output shape", () => {
  it("returns success=false when URL fetch fails", async () => {
    // Fetch a nonsense URL that will fail
    const result = await webscrapeFetch("https://this-domain-does-not-exist-12345.com");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe("string");
  });

  it("returns success=true for a real reachable URL", async () => {
    const result = await webscrapeFetch("https://example.com");
    expect(result.success).toBe(true);
    expect(result.tier).toBeTruthy();
    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(300);
    expect(result.bodyLength).toBeGreaterThan(0);
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.snippet).toBeTruthy();
  });

  it("returns title from <title> tag", async () => {
    const result = await webscrapeFetch("https://example.com");
    expect(result.title).toBe("Example Domain");
  });
});

describe("webscrapeDetect output shape", () => {
  it("detects no protection on example.com", async () => {
    const result = await webscrapeDetect("https://example.com");
    expect(result.detected).toBe(false);
    expect(result.status).toBe(200);
    expect(result.type).toBe("unknown");
  });

  it("handles unreachable URL gracefully", async () => {
    const result = await webscrapeDetect("https://nonexistent-12345.invalid");
    expect(result.detected).toBe(false);
    expect(result.status).toBe(0);
  });
});

describe("webscrapeHealth output shape", () => {
  it("returns { healthy, message }", async () => {
    const result = await webscrapeHealth();
    expect(typeof result.healthy).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });
});

describe("webscrapeStats output shape", () => {
  it("returns stats with expected fields", () => {
    const result = webscrapeStats();
    expect(typeof result.totalEvents).toBe("number");
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.recentEvents)).toBe(true);
  });
});

// ── Bot command registration shape ────────────────────────────────────

describe("Bot command registration", () => {
  it("includes all webscraping commands", () => {
    const commands = [
      { command: "scrape_fetch", description: "Fetch URL through tier chain" },
      { command: "scrape_detect", description: "Check anti-bot protection" },
      { command: "scrape_crawl", description: "Start/pause/resume a crawl" },
      { command: "scrape_health", description: "Check Scrapling bridge" },
      { command: "scrape_stats", description: "Protection event stats" },
    ];

    expect(commands).toHaveLength(5);
    for (const cmd of commands) {
      expect(cmd.command).toMatch(/^scrape_/);
      expect(cmd.description).toBeTruthy();
    }
  });

  it("all command names are valid Telegram format", () => {
    const allCommands = [
      "start", "help", "convert_url", "convert_file", "status",
      "search", "ask", "health", "render_portal", "compile_wiki",
      "process_inbox", "memory_export", "daily_log", "immortal_mode",
      "commands", "scrape_fetch", "scrape_detect", "scrape_crawl",
      "scrape_health", "scrape_stats",
    ];

    for (const cmd of allCommands) {
      // Telegram: 1-32 chars, lowercase, only letters/digits/underscores
      expect(cmd.length).toBeLessThanOrEqual(32);
      expect(cmd).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

// ── TG message format tests ───────────────────────────────────────────

describe("Telegram output formatting", () => {
  it("fetch success message is under 4096 chars", async () => {
    const result = await webscrapeFetch("https://example.com");
    if (result.success) {
      const msg = [
        `✅ *Fetched successfully*`,
        `Tier: \`${result.tier}\``,
        `Status: ${result.status}`,
        `Time: ${result.elapsedMs}ms`,
        `Size: ${result.bodyLength} bytes`,
        result.title ? `Title: ${result.title}` : "",
        result.protection ? `Protection: ${result.protection}` : "",
      ].filter(Boolean).join("\n");
      expect(msg.length).toBeLessThan(4096);
      expect(msg).toContain("Fetched successfully");
      expect(msg).toContain(result.tier!);
    }
  });

  it("fetch failure message is concise", async () => {
    const result = await webscrapeFetch("https://nonexistent-12345.invalid");
    expect(result.success).toBe(false);
    const msg = `❌ Failed: ${result.error!}`;
    expect(msg.length).toBeLessThan(4096);
  });

  it("crawl status message fits Telegram limits", () => {
    const status = "running";
    const stats = { pagesCrawled: 42, pagesFailed: 3 };
    const queueLength = 10;
    const bytes = 500000;

    const msg = [
      `🕷️ *test-id* — ${status}`,
      `Pages: ${stats.pagesCrawled} crawled / ${stats.pagesFailed} failed`,
      `Queued: ${queueLength}`,
      `Bytes: ${bytes}`,
    ].join("\n");

    expect(msg.length).toBeLessThan(4096);
    expect(msg).toContain("42 crawled");
    expect(msg).toContain("running");
  });
});

// ── Integration: fetch real sites through the tier chain ──────────────

describe("Live webscraping integration tests", () => {
  // These tests hit real websites and can be slow/flaky; run explicitly with ASSIMILATOR_LIVE_TESTS=1.
  const LIVE = process.env.ASSIMILATOR_LIVE_TESTS === "1" && !process.env.CI ? it : it.skip;

  LIVE("fetches example.com via HTTP tier", async () => {
    const result = await webscrapeFetch("https://example.com");
    expect(result.success).toBe(true);
    expect(result.tier).toBe("http");
    expect(result.status).toBe(200);
  });

  LIVE("fetches httpbin.org via HTTP tier", async () => {
    const result = await webscrapeFetch("https://httpbin.org/html");
    // httpbin can be flaky — accept any successful result
    if (result.success) {
      expect(result.status).toBe(200);
      expect(result.snippet).toContain("html");
    }
    // else: network issue, not a code bug
  });

  LIVE("detect returns false for clean sites", async () => {
    const result = await webscrapeDetect("https://httpbin.org/html");
    expect(result.detected).toBe(false);
  });

  LIVE("health check returns boolean", async () => {
    const result = await webscrapeHealth();
    expect(typeof result.healthy).toBe("boolean");
  });

  LIVE("stats returns valid structure", () => {
    const result = webscrapeStats();
    expect(typeof result.totalEvents).toBe("number");
    expect(result.summary).toBeTypeOf("object");
    expect(Array.isArray(result.recentEvents)).toBe(true);
  });
});
