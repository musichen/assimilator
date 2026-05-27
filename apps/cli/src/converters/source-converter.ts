import fs from "node:fs/promises";
import path from "node:path";
import type { SourceType } from "../core/schemas.js";
import { convertWithMarkitCli, convertWithMarkitLibrary, findMarkitCommand } from "./markit.js";
import { convertWithMarkitdownCli } from "./markitdown.js";
import { detectSourceType, normalizeToMarkdown } from "./passthrough.js";

export interface SourceConversionResult {
  sourceType: SourceType;
  markdown: string;
  title?: string;
  warnings: string[];
  converter: "local" | "markit";
}

export interface SourceConversionOptions {
  markitCommand?: string[];
}

const localExtensions = new Set([".md", ".markdown", ".txt", ".html", ".htm"]);

export async function convertLocalFileToMarkdown(
  inputPath: string,
  options: SourceConversionOptions = {}
): Promise<SourceConversionResult> {
  const sourceType = detectSourceType(inputPath);
  const ext = path.extname(inputPath).toLowerCase();
  if (localExtensions.has(ext)) {
    const originalText = await fs.readFile(inputPath, "utf8");
    return {
      sourceType,
      markdown: normalizeToMarkdown(sourceType, originalText),
      warnings: [],
      converter: "local"
    };
  }

  const markitCommand = options.markitCommand ?? await findMarkitCommand();
  const warnings: string[] = [];
  const result = await (async () => {
    try {
      return markitCommand
        ? await convertWithMarkitCli(inputPath, markitCommand)
        : await convertWithMarkitLibrary(inputPath);
    } catch (error) {
      warnings.push(`markit-ai failed: ${error instanceof Error ? error.message : String(error)}`);
      return convertWithMarkitdownCli(inputPath);
    }
  })();
  return {
    sourceType,
    markdown: result.markdown.trim(),
    title: result.title,
    warnings: [...warnings, ...result.warnings],
    converter: "markit"
  };
}
