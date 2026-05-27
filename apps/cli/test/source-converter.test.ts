import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertLocalFileToMarkdown } from "../src/converters/source-converter.js";
import { isYoutubeUrl, vttToText } from "../src/converters/youtube.js";

describe("source converter", () => {
  it("uses local conversion for Markdown and Showdown HTML import", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-convert-"));
    const markdownPath = path.join(root, "note.md");
    const htmlPath = path.join(root, "article.html");
    await fs.writeFile(markdownPath, "# Local Note\n\nKeep this markdown.");
    await fs.writeFile(htmlPath, "<h1>Article</h1><p><strong>Rendered</strong> from HTML.</p><ul><li>First</li></ul>");

    const markdown = await convertLocalFileToMarkdown(markdownPath);
    expect(markdown.converter).toBe("local");
    expect(markdown.sourceType).toBe("markdown");
    expect(markdown.markdown).toContain("# Local Note");

    const html = await convertLocalFileToMarkdown(htmlPath);
    expect(html.converter).toBe("local");
    expect(html.sourceType).toBe("html");
    expect(html.markdown).toContain("# Article");
    expect(html.markdown).toContain("**Rendered** from HTML.");
    expect(html.markdown).toContain("- First");
  });

  it("uses a Markit command for richer formats", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-markit-"));
    const csvPath = path.join(root, "data.csv");
    await fs.writeFile(csvPath, "name,value\nHermes,1\n");
    const script = "console.log('# Converted by fake Markit\\n\\n' + process.argv[1]);";

    const result = await convertLocalFileToMarkdown(csvPath, {
      markitCommand: ["node", "-e", script]
    });

    expect(result.converter).toBe("markit");
    expect(result.sourceType).toBe("dataset");
    expect(result.markdown).toContain("Converted by fake Markit");
    expect(result.markdown).toContain(csvPath);
  });

  it("normalizes yt-dlp VTT subtitles into transcript text", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:01.000",
      "<c>Hello</c> world",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "Hello world",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "Next line"
    ].join("\n");

    expect(vttToText(vtt)).toBe("Hello world\nNext line");
  });

  it("recognizes escaped YouTube watch URLs after shell-style backslashes are removed by conversion layer", () => {
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
  });
});
