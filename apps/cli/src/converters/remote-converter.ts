import { convertUrlWithMarkitLibrary, type MarkitAdapterResult } from "./markit.js";
import { convertWithMarkitdownCli } from "./markitdown.js";
import { convertYoutubeWithYtDlp, isYoutubeUrl, readYoutubeTitle } from "./youtube.js";

export interface RemoteConversionResult {
  markdown: string;
  title?: string;
  sourceType: "url" | "youtube";
  warnings: string[];
  converter: "yt-dlp" | "markit-ai" | "markitdown";
}

export async function convertRemoteToMarkdown(url: string, onProgress?: (message: string) => void): Promise<RemoteConversionResult> {
  const warnings: string[] = [];
  const youtube = isYoutubeUrl(url);
  if (youtube) onProgress?.("YouTube URL detected");
  const youtubeTitle = youtube ? await readYoutubeTitle(url).catch(() => undefined) : undefined;
  if (youtubeTitle) onProgress?.(`Video title: ${youtubeTitle}`);

  if (youtube) {
    try {
      onProgress?.("Trying yt-dlp subtitles/transcript extraction");
      const result = await convertYoutubeWithYtDlp(url);
      return { ...result, title: result.title ?? youtubeTitle, sourceType: "youtube", converter: "yt-dlp" };
    } catch (error) {
      warnings.push(`yt-dlp failed: ${error instanceof Error ? error.message : String(error)}`);
      onProgress?.("yt-dlp transcript extraction failed; trying MarkItDown fallback");
    }

    try {
      onProgress?.("Trying Microsoft MarkItDown YouTube fallback");
      const fallback = await convertWithMarkitdownCli(url);
      assertYoutubeTranscript(fallback.markdown);
      return {
        markdown: fallback.markdown,
        title: normalizeRemoteTitle(fallback.title, youtubeTitle),
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

  try {
    onProgress?.("Trying markit-ai URL conversion");
    const result: MarkitAdapterResult = await convertUrlWithMarkitLibrary(url);
    return {
      markdown: result.markdown,
      title: normalizeRemoteTitle(result.title, youtubeTitle),
      sourceType: "url",
      warnings: [...warnings, ...result.warnings],
      converter: "markit-ai"
    };
  } catch (error) {
    warnings.push(`markit-ai failed: ${error instanceof Error ? error.message : String(error)}`);
    onProgress?.("markit-ai URL conversion failed; trying MarkItDown fallback");
  }

  onProgress?.("Trying Microsoft MarkItDown URL fallback");
  const fallback = await convertWithMarkitdownCli(url);
  return { markdown: fallback.markdown, title: fallback.title, sourceType: "url", warnings: [...warnings, ...fallback.warnings], converter: "markitdown" };
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
