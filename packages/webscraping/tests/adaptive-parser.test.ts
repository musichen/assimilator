/**
 * Tests for adaptive-parser.ts — validateCssSelector (pure function).
 * The relocateSelector functions require the Python bridge to be running
 * and are tested via integration tests.
 */
import { describe, it, expect } from "vitest";
import { validateCssSelector } from "../src/adaptive-parser.js";

// ---------------------------------------------------------------------------
// validateCssSelector
// ---------------------------------------------------------------------------

describe("validateCssSelector", () => {
  const sampleHtml = `
    <html>
      <head><title>Test Page</title></head>
      <body>
        <div id="main-content">
          <h1 class="title primary">Hello World</h1>
          <p class="description">Some text here.</p>
          <div class="card featured">
            <span class="label">Card 1</span>
          </div>
          <div class="card">
            <span class="label">Card 2</span>
          </div>
          <div class="card">
            <span class="label">Card 3</span>
          </div>
          <section id="footer" class="grid">
            <a href="/about">About</a>
          </section>
        </div>
      </body>
    </html>`;

  it("counts elements by tag name", () => {
    // Just a bare tag selector
    expect(validateCssSelector(sampleHtml, "div")).toBe(4); // main-content + 3 cards
  });

  it("counts elements by id selector with tag", () => {
    // #main-content without a tag — the lightweight validator needs a tag prefix
    expect(validateCssSelector(sampleHtml, "div#main-content")).toBe(1);
  });

  it("returns 0 for id-only selector (no tag — lightweight regex)", () => {
    // The validator requires a tag name; bare #id doesn't match the regex
    expect(validateCssSelector(sampleHtml, "#main-content")).toBe(0);
  });

  it("counts elements by class with tag", () => {
    expect(validateCssSelector(sampleHtml, "div.card")).toBe(3);
  });

  it("returns 0 for class-only selector (no tag)", () => {
    expect(validateCssSelector(sampleHtml, ".card")).toBe(0);
  });

  it("counts elements by compound class (matches first class)", () => {
    // The validator extracts only the first class; div.card.featured
    // matches all 3 <div class="card ..."> elements
    expect(validateCssSelector(sampleHtml, "div.card.featured")).toBe(3);
  });

  it("returns 0 for non-matching id", () => {
    expect(validateCssSelector(sampleHtml, "#nonexistent")).toBe(0);
  });

  it("returns 0 for non-matching class", () => {
    expect(validateCssSelector(sampleHtml, ".nonexistent")).toBe(0);
  });

  it("returns 0 for non-matching tag", () => {
    expect(validateCssSelector(sampleHtml, "table")).toBe(0);
  });

  it("returns 0 for empty selector", () => {
    expect(validateCssSelector(sampleHtml, "")).toBe(0);
  });

  it("returns 0 for empty html", () => {
    expect(validateCssSelector("", "div")).toBe(0);
  });

  it("counts headings", () => {
    expect(validateCssSelector(sampleHtml, "h1")).toBe(1);
    expect(validateCssSelector(sampleHtml, "h2")).toBe(0);
  });

  it("counts span elements inside cards", () => {
    expect(validateCssSelector(sampleHtml, "span.label")).toBe(3);
  });
});
