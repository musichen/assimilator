import { convertUrlWithDefuddle } from "./defuddle.js";
import { convertUrlWithMarkitLibrary, type MarkitAdapterResult } from "./markit.js";
import { convertWithMarkitdownCli } from "./markitdown.js";
import { convertYoutubeWithYtDlp, isYoutubeUrl, RETRY_YOUTUBE_EXTRACTOR_ARGS, RETRY_YOUTUBE_SUB_LANGS } from "./youtube.js";
import { isLinkedinUrl, convertLinkedinWithPuppeteer } from "./linkedin.js";
import { isDifficultSite, convertDifficultSite } from "./webscraping.js";

export interface RemoteConversionResult {
  markdown: string;
  title?: string;
  sourceType: "url" | "youtube" | "linkedin";
  warnings: string[];
  converter: "yt-dlp" | "defuddle" | "markit-ai" | "markitdown" | "puppeteer" | "webscraping";
}

export async function convertRemoteToMarkdown(
  url: string,
  onProgress?: (message: string) => void,
  respectTos?: boolean,
): Promise<RemoteConversionResult> {
  const warnings: string[] = [];
  const youtube = isYoutubeUrl(url);
  if (youtube) onProgress?.("YouTube URL detected");

  if (youtube) {
    // Retry with a different client/lang set: identical retries just re-hit the
    // same YouTube 429 / bot-check that caused the first timeout.
    let lastYtDlpError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        onProgress?.(`Trying yt-dlp subtitles/transcript extraction${attempt > 1 ? " (retry, android/ios + en-only)" : ""}`);
        const result = await convertYoutubeWithYtDlp(url, attempt === 1 ? {} : {
          subLangs: RETRY_YOUTUBE_SUB_LANGS,
          extractorArgs: RETRY_YOUTUBE_EXTRACTOR_ARGS,
        });
        return { ...result, sourceType: "youtube", converter: "yt-dlp" };
      } catch (error) {
        lastYtDlpError = error;
        warnings.push(`yt-dlp attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
        onProgress?.(`yt-dlp transcript extraction failed${attempt < 2 ? " — retrying with a different player client" : "; trying MarkItDown fallback"}`);
      }
    }
    void lastYtDlpError;

    try {
      onProgress?.("Trying Microsoft MarkItDown YouTube fallback");
      const fallback = await convertWithMarkitdownCli(url);
      assertYoutubeTranscript(fallback.markdown);
      return {
        markdown: fallback.markdown,
        title: normalizeRemoteTitle(fallback.title, undefined),
        sourceType: "youtube",
        warnings: [...warnings, ...fallback.warnings],
        converter: "markitdown"
      };
    } catch (error) {
      warnings.push(`markitdown failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    throw new Error([
      "YouTube conversion failed: no usable transcript was extracted.",
      "ASSIMILATOR will not save a generic YouTube webpage as a fake transcript.",
      ...warnings
    ].join("\n"));
  }

  const linkedin = isLinkedinUrl(url);
  if (linkedin) {
    onProgress?.("LinkedIn URL detected");
    try {
      onProgress?.("Launching headless Chrome for LinkedIn content extraction");
      const result = await convertLinkedinWithPuppeteer(url, {
        headless: true,
        userDataDir: process.env.LINKEDIN_USER_DATA_DIR,
      });
      if (result.markdown.trim()) {
        onProgress?.("LinkedIn content extracted successfully");
        return {
          markdown: result.markdown,
          title: result.title,
          sourceType: "linkedin",
          warnings: [...warnings, ...result.warnings],
          converter: "puppeteer",
        };
      }
      warnings.push("Puppeteer extracted empty content — may require login");
    } catch (error) {
      warnings.push(`Puppeteer failed: ${error instanceof Error ? error.message : String(error)}`);
      onProgress?.("LinkedIn Puppeteer extraction failed");
    }

    // LinkedIn fallback: try webscraping multi-tier chain
    try {
      onProgress?.("Trying multi-tier webscraping fallback for LinkedIn");
      const wsResult = await convertDifficultSite(url, onProgress, respectTos);
      if (wsResult.markdown.trim()) {
        return {
          markdown: wsResult.markdown,
          title: wsResult.title,
          sourceType: "linkedin",
          warnings: [...warnings, ...wsResult.warnings],
          converter: "webscraping",
        };
      }
      warnings.push("Webscraping returned empty content");
    } catch (error) {
      warnings.push(`Webscraping fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Fall through to generic converters as last resort
    onProgress?.("Falling back to generic URL converters for LinkedIn");
  }

  // For other difficult sites, try webscraping before generic converters
  const difficult = !linkedin && isDifficultSite(url);
  if (difficult) {
    onProgress?.("Difficult site detected — trying multi-tier webscraping");
    try {
      const wsResult = await convertDifficultSite(url, onProgress, respectTos);
      if (wsResult.markdown.trim()) {
        return {
          markdown: wsResult.markdown,
          title: wsResult.title,
          sourceType: "url",
          warnings: [...warnings, ...wsResult.warnings],
          converter: "webscraping",
        };
      }
    } catch (error) {
      warnings.push(`Webscraping failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    onProgress?.("Webscraping failed — falling back to generic converters");
  }

  try {
    onProgress?.("Trying Defuddle reader-mode extraction");
    const result = await convertUrlWithDefuddle(url);
    return {
      markdown: result.markdown,
      title: normalizeRemoteTitle(result.title, undefined),
      sourceType: linkedin ? "linkedin" : "url",
      warnings: [...warnings, ...result.warnings],
      converter: "defuddle"
    };
  } catch (error) {
    warnings.push(`defuddle failed: ${error instanceof Error ? error.message : String(error)}`);
    onProgress?.("Defuddle reader-mode extraction failed; trying markit-ai URL conversion");
  }

  try {
    onProgress?.("Trying markit-ai URL conversion");
    const result: MarkitAdapterResult = await convertUrlWithMarkitLibrary(url);
    return {
      markdown: result.markdown,
      title: normalizeRemoteTitle(result.title, undefined),
      sourceType: linkedin ? "linkedin" : "url",
      warnings: [...warnings, ...result.warnings],
      converter: "markit-ai"
    };
  } catch (error) {
    warnings.push(`markit-ai failed: ${error instanceof Error ? error.message : String(error)}`);
    onProgress?.("markit-ai URL conversion failed; trying MarkItDown fallback");
  }

  onProgress?.("Trying Microsoft MarkItDown URL fallback");
  try {
    const fallback = await convertWithMarkitdownCli(url);
    return { markdown: fallback.markdown, title: fallback.title, sourceType: linkedin ? "linkedin" : "url", warnings: [...warnings, ...fallback.warnings], converter: "markitdown" };
  } catch (markitError) {
    warnings.push(`markitdown failed: ${markitError instanceof Error ? markitError.message : String(markitError)}`);
    // Retry with webscraping tier chain on 403/blocked responses
    try {
      onProgress?.("MarkItDown blocked — retrying with webscraping tier chain");
      const wsResult = await convertDifficultSite(url, onProgress, respectTos);
      if (wsResult.markdown.trim()) {
        return {
          markdown: wsResult.markdown,
          title: wsResult.title,
          sourceType: linkedin ? "linkedin" : "url",
          warnings: [...warnings, ...wsResult.warnings],
          converter: "webscraping",
        };
      }
    } catch (wsError) {
      warnings.push(`webscraping retry failed: ${wsError instanceof Error ? wsError.message : String(wsError)}`);
    }
    throw markitError;
  }
}

function normalizeRemoteTitle(title: string | undefined, preferredTitle: string | undefined): string | undefined {
  if (!title) return preferredTitle;
  const generic = ["youtube", "watch", "www-youtube-com-watch", "video"];
  return generic.includes(title.trim().toLowerCase()) ? preferredTitle ?? title : title;
}

function assertYoutubeTranscript(markdown: string): void {
  if (!isUsableYoutubeTranscript(markdown)) {
    throw new Error("fallback output does not look like a transcript");
  }
}

export function isUsableYoutubeTranscript(markdown: string): boolean {
  const lower = markdown.toLowerCase();
  const looksGeneric =
    lower.includes("© 2026 google llc") ||
    lower.includes("youtube.com/about") ||
    /^#?\s*youtube\s*$/im.test(markdown.trim());
  const hasTranscriptSignal =
    lower.includes("transcript") ||
    lower.includes("caption") ||
    markdown.split(/\s+/).length > 250;

  return !looksGeneric && hasTranscriptSignal;
}
