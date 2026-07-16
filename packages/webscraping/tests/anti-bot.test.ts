/**
 * Tests for anti-bot.ts — protection detection and event logging.
 * All pure functions, no network or filesystem access needed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectProtection,
  detectFromResult,
  logProtectionEvent,
  getProtectionEvents,
  queryProtectionEvents,
  clearProtectionEvents,
  protectionSummary,
} from "../src/anti-bot.js";
import type { ProtectionDetection } from "../src/types.js";

beforeEach(() => {
  clearProtectionEvents();
});

// ---------------------------------------------------------------------------
// detectProtection
// ---------------------------------------------------------------------------

describe("detectProtection", () => {
  it("returns no detection for a normal 200 HTML page", () => {
    const result = detectProtection(
      "<html><body><h1>Welcome</h1></body></html>",
      200,
    );
    expect(result.detected).toBe(false);
    expect(result.type).toBe("unknown");
  });

  it("detects Cloudflare Turnstile on 403 with turnstile widget", () => {
    const body = `
      <html><body>
        <div class="cf-turnstile" data-sitekey="xxx"></div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
      </body></html>`;
    const result = detectProtection(body, 403);
    expect(result.detected).toBe(true);
    expect(result.type).toBe("cloudflare-turnstile");
    expect(result.confidence).toBe("high");
  });

  it("detects Cloudflare interstitial on 403", () => {
    const body = `
      <html><body>
        Checking your browser before accessing the site.
        DDoS protection by Cloudflare
        Ray ID: 123abc
      </body></html>`;
    const result = detectProtection(body, 403, {
      "cf-ray": "123abc-xyz",
      "server": "cloudflare",
    });
    expect(result.detected).toBe(true);
    expect(result.type).toBe("cloudflare-interstitial");
    expect(result.confidence).toBe("high");
  });

  it("detects Cloudflare JS challenge", () => {
    const body = `
      <html><body>
        <script>var t,r,a,n, s, o,i,c = "jschl-answer"...</script>
        <input type="hidden" name="jschl_vc" value="xxx"/>
      </body></html>`;
    const result = detectProtection(body, 503, {
      "cf-chl-out": "xxx",
    });
    expect(result.detected).toBe(true);
    expect(result.type).toBe("cloudflare-js-challenge");
  });

  it("detects DataDome on 403 with x-datadome header", () => {
    const body = "<html><body>Please verify you are human</body></html>";
    const result = detectProtection(body, 403, {
      "x-datadome": "protected",
    });
    expect(result.detected).toBe(true);
    expect(result.type).toBe("datadome");
    expect(result.confidence).toBe("high");
  });

  it("detects Akamai bot manager", () => {
    const body = `<html><body>akamai</body></html>`;
    const result = detectProtection(body, 403, {
      "x-akamai-transformed": "9",
    });
    expect(result.detected).toBe(true);
    expect(result.type).toBe("akamai");
  });

  it("detects Imperva / Incapsula", () => {
    const body = `<html><body>_Incapsula_Resource</body></html>`;
    const result = detectProtection(body, 403);
    expect(result.detected).toBe(true);
    expect(result.type).toBe("imperva");
  });

  it("detects Sucuri firewall", () => {
    const body = `Access Denied - Sucuri CloudProxy`;
    const result = detectProtection(body, 403, {
      "x-sucuri-id": "12345",
    });
    expect(result.detected).toBe(true);
    expect(result.type).toBe("sucuri");
  });

  it("detects generic CAPTCHA on 403", () => {
    const body =
      '<html><body><div class="g-recaptcha" data-sitekey="xxx"></div></body></html>';
    const result = detectProtection(body, 403);
    expect(result.detected).toBe(true);
    expect(result.type).toBe("generic-captcha");
    expect(result.confidence).toBe("medium");
  });

  it("does NOT flag legitimate reCAPTCHA on a 200 page", () => {
    // Sites often embed captcha without blocking — should not trigger on 200
    const body =
      '<html><body><form><div class="g-recaptcha"></div></form></body></html>';
    const result = detectProtection(body, 200);
    expect(result.detected).toBe(false);
  });

  it("detects generic access-denied block", () => {
    const body = "<html><body>Access Denied — your IP has been blocked</body></html>";
    const result = detectProtection(body, 403);
    expect(result.detected).toBe(true);
    expect(result.type).toBe("generic-block");
  });

  it("detects JavaScript/cookie gate", () => {
    const body = "<html><body>Please enable JavaScript to continue</body></html>";
    const result = detectProtection(body, 403);
    expect(result.detected).toBe(true);
    expect(result.type).toBe("generic-block");
    expect(result.confidence).toBe("low");
  });

  it("scans only first 5KB of body", () => {
    // Put the protection signal at byte 6000 (beyond the scan window)
    const prefix = "x".repeat(6000);
    const suffix = '<div class="cf-turnstile"></div>';
    const body = prefix + suffix;
    const result = detectProtection(body, 403);
    // Should not detect because turnstile is beyond the 5KB scan window
    expect(result.detected).toBe(false);
  });

  it("handles empty body", () => {
    const result = detectProtection("", 200);
    expect(result.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectFromResult
// ---------------------------------------------------------------------------

describe("detectFromResult", () => {
  it("wraps detectProtection using FetchResult fields", () => {
    const result = detectFromResult({
      status: 403,
      headers: { "cf-ray": "abc" },
      body: "Just a moment... Cloudflare",
      finalUrl: "https://example.com",
      tier: "http",
      elapsedMs: 100,
    });
    expect(result.detected).toBe(true);
    expect(result.type).toBe("cloudflare-interstitial");
  });
});

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

describe("event logging", () => {
  it("logProtectionEvent records an event", () => {
    const detection: ProtectionDetection = {
      detected: true,
      type: "cloudflare-turnstile",
      confidence: "high",
      details: "Cloudflare Turnstile widget detected",
    };

    const event = logProtectionEvent(
      "https://example.com/page",
      "http",
      detection,
      { status: 403, headers: { "cf-ray": "abc" } },
    );

    expect(event.url).toBe("https://example.com/page");
    expect(event.tier).toBe("http");
    expect(event.protection).toBe("cloudflare-turnstile");
    expect(event.statusCode).toBe(403);
    expect(event.detectedAt).toBeTruthy();
  });

  it("getProtectionEvents returns events newest first", () => {
    const detection: ProtectionDetection = {
      detected: true,
      type: "cloudflare-interstitial",
      confidence: "high",
      details: "test",
    };

    logProtectionEvent("https://a.com", "http", detection, {
      status: 403,
      headers: {},
    });
    logProtectionEvent("https://b.com", "stealthy", detection, {
      status: 403,
      headers: {},
    });

    const events = getProtectionEvents();
    expect(events).toHaveLength(2);
    // Newest first: b.com should be first since it was logged last
    expect(events[0]!.url).toBe("https://b.com");
    expect(events[1]!.url).toBe("https://a.com");
  });

  it("queryProtectionEvents filters by tier", () => {
    const detection: ProtectionDetection = {
      detected: true,
      type: "generic-block",
      confidence: "medium",
      details: "test",
    };

    logProtectionEvent("https://a.com", "http", detection, {
      status: 403,
      headers: {},
    });
    logProtectionEvent("https://b.com", "stealthy", detection, {
      status: 403,
      headers: {},
    });

    const httpEvents = queryProtectionEvents({ tier: "http" });
    expect(httpEvents).toHaveLength(1);
    expect(httpEvents[0]!.url).toBe("https://a.com");
  });

  it("queryProtectionEvents filters by url", () => {
    const detection: ProtectionDetection = {
      detected: true,
      type: "generic-block",
      confidence: "medium",
      details: "test",
    };

    logProtectionEvent("https://keep.com", "http", detection, {
      status: 403,
      headers: {},
    });
    logProtectionEvent("https://drop.com", "http", detection, {
      status: 403,
      headers: {},
    });

    const filtered = queryProtectionEvents({ url: "https://keep.com" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.url).toBe("https://keep.com");
  });

  it("queryProtectionEvents filters by protection type", () => {
    const cf: ProtectionDetection = {
      detected: true,
      type: "cloudflare-turnstile",
      confidence: "high",
      details: "cf",
    };
    const block: ProtectionDetection = {
      detected: true,
      type: "generic-block",
      confidence: "medium",
      details: "block",
    };

    logProtectionEvent("https://a.com", "http", cf, {
      status: 403,
      headers: {},
    });
    logProtectionEvent("https://b.com", "http", block, {
      status: 403,
      headers: {},
    });

    const cfEvents = queryProtectionEvents({
      protection: "cloudflare-turnstile",
    });
    expect(cfEvents).toHaveLength(1);
  });

  it("queryProtectionEvents respects limit", () => {
    const detection: ProtectionDetection = {
      detected: true,
      type: "generic-block",
      confidence: "medium",
      details: "test",
    };

    for (let i = 0; i < 10; i++) {
      logProtectionEvent(`https://page-${i}.com`, "http", detection, {
        status: 403,
        headers: {},
      });
    }

    const limited = queryProtectionEvents({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("clearProtectionEvents empties the log", () => {
    const detection: ProtectionDetection = {
      detected: true,
      type: "generic-block",
      confidence: "medium",
      details: "test",
    };

    logProtectionEvent("https://a.com", "http", detection, {
      status: 403,
      headers: {},
    });
    expect(getProtectionEvents()).toHaveLength(1);

    clearProtectionEvents();
    expect(getProtectionEvents()).toHaveLength(0);
  });

  it("protectionSummary groups by type", () => {
    const cf: ProtectionDetection = {
      detected: true,
      type: "cloudflare-turnstile",
      confidence: "high",
      details: "cf",
    };
    const dd: ProtectionDetection = {
      detected: true,
      type: "datadome",
      confidence: "high",
      details: "dd",
    };

    logProtectionEvent("https://a.com", "http", cf, {
      status: 403,
      headers: {},
    });
    logProtectionEvent("https://b.com", "stealthy", cf, {
      status: 403,
      headers: {},
    });
    logProtectionEvent("https://c.com", "http", dd, {
      status: 403,
      headers: {},
    });

    const summary = protectionSummary();
    expect(summary["cloudflare-turnstile"]!.count).toBe(2);
    expect(summary["datadome"]!.count).toBe(1);
  });
});
