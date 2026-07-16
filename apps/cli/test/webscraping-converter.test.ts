/**
 * Tests for webscraping converter — isDifficultSite and extractHtmlTitle.
 * These functions live in apps/cli/src/converters/webscraping.ts.
 */
import { describe, it, expect } from "vitest";
import { isDifficultSite } from "../src/converters/webscraping.js";

describe("isDifficultSite", () => {
  it("identifies linkedin.com as difficult", () => {
    expect(isDifficultSite("https://www.linkedin.com/feed/update/123")).toBe(true);
    expect(isDifficultSite("https://linkedin.com/in/someone")).toBe(true);
  });

  it("identifies glassdoor.com as difficult", () => {
    expect(isDifficultSite("https://www.glassdoor.com/Reviews/index.htm")).toBe(true);
  });

  it("identifies indeed.com as difficult", () => {
    expect(isDifficultSite("https://indeed.com/jobs")).toBe(true);
    expect(isDifficultSite("https://www.indeed.com/q-developer-l-london-jobs.html")).toBe(true);
  });

  it("identifies instagram.com as difficult", () => {
    expect(isDifficultSite("https://www.instagram.com/p/abc123/")).toBe(true);
  });

  it("identifies tiktok.com as difficult", () => {
    expect(isDifficultSite("https://www.tiktok.com/@user/video/123")).toBe(true);
  });

  it("identifies twitter.com/x.com as difficult", () => {
    expect(isDifficultSite("https://twitter.com/user/status/123")).toBe(true);
    expect(isDifficultSite("https://x.com/user/status/123")).toBe(true);
    expect(isDifficultSite("https://www.x.com/user")).toBe(true);
  });

  it("identifies crunchbase.com as difficult", () => {
    expect(isDifficultSite("https://www.crunchbase.com/organization/example")).toBe(true);
  });

  it("identifies pitchbook.com as difficult", () => {
    expect(isDifficultSite("https://pitchbook.com/profiles/company/123")).toBe(true);
  });

  it("identifies zoominfo.com as difficult", () => {
    expect(isDifficultSite("https://www.zoominfo.com/c/example/123")).toBe(true);
  });

  it("returns false for normal sites", () => {
    expect(isDifficultSite("https://example.com")).toBe(false);
    expect(isDifficultSite("https://github.com")).toBe(false);
    expect(isDifficultSite("https://www.google.com")).toBe(false);
    expect(isDifficultSite("https://en.wikipedia.org/wiki/Example")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isDifficultSite("not-a-url")).toBe(false);
    expect(isDifficultSite("")).toBe(false);
  });

  it("handles URLs with paths and query strings", () => {
    expect(isDifficultSite("https://www.linkedin.com/posts/abc123?utm_source=share")).toBe(true);
    expect(isDifficultSite("https://github.com/facebook/react?tab=readme")).toBe(false);
  });

  it("handles URLs without www prefix", () => {
    expect(isDifficultSite("https://linkedin.com/feed")).toBe(true);
    expect(isDifficultSite("https://x.com")).toBe(true);
  });
});
