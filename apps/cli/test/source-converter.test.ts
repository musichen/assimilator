import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertLocalFileToMarkdown } from "../src/converters/source-converter.js";
import { isYoutubeUrl, vttToText, buildYoutubeSubtitleArgs, pickPreferredSubtitle, DEFAULT_YOUTUBE_SUB_LANGS } from "../src/converters/youtube.js";
import { cleanVideoUrl, extractYoutubeVideoId, formatProgressBar, parseYtDlpProgressLine, YOUTUBE_METADATA_TIMEOUT_MS } from "../src/converters/youtube-mp3.js";

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

  it("does not request every auto-translated subtitle variant", () => {
    const args = buildYoutubeSubtitleArgs("https://www.youtube.com/watch?v=abc123", "/tmp/out.%(ext)s");
    const langs = args[args.indexOf("--sub-langs") + 1];
    expect(langs).toBe(DEFAULT_YOUTUBE_SUB_LANGS);
    expect(langs).not.toContain(".*");
    expect(args).toContain("--socket-timeout");
    expect(args).toContain("--extractor-args");
    expect(args).toContain("--no-playlist");
  });

  it("prefers original English captions over translations", () => {
    expect(pickPreferredSubtitle([
      "5FcHP22u0zs.ru-en.vtt",
      "5FcHP22u0zs.en.vtt",
      "5FcHP22u0zs.en-orig.vtt",
    ])).toBe("5FcHP22u0zs.en-orig.vtt");
  });
});

describe("youtube mp3 helpers", () => {
  it("strips share-tracking junk from youtu.be links", () => {
    expect(extractYoutubeVideoId("https://youtu.be/EkFuv7cjJCA?is=RQO-YCOamq5eDcTy")).toBe("EkFuv7cjJCA");
    expect(cleanVideoUrl("https://youtu.be/EkFuv7cjJCA?is=RQO-YCOamq5eDcTy"))
      .toBe("https://www.youtube.com/watch?v=EkFuv7cjJCA");
  });

  it("caps the metadata probe far below the 8-minute download timeout", () => {
    expect(YOUTUBE_METADATA_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("turns yt-dlp download lines into a progress bar", () => {
    const formatted = formatProgressBar("[download]  42.3% of  3.99MiB at  1.42MiB/s ETA 00:02");
    expect(formatted).toContain("42.3%");
    expect(formatted).toContain("ETA 00:02");
    expect(parseYtDlpProgressLine("not a progress line")).toBeNull();
  });
});
