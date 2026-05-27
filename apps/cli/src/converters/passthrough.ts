import path from "node:path";
import type { SourceType } from "../core/schemas.js";
import { htmlToMarkdown } from "./showdown.js";

export function detectSourceType(filePath: string): SourceType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".txt") return "txt";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (ext === ".mobi") return "mobi";
  if (ext === ".docx") return "docx";
  if ([".csv", ".tsv", ".json", ".yaml", ".yml", ".xlsx"].includes(ext)) return "dataset";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".m4a", ".flac"].includes(ext)) return "audio";
  if ([".log", ".rst"].includes(ext)) return "txt";
  return "txt";
}

export function rawDirectoryForSourceType(sourceType: SourceType): string {
  switch (sourceType) {
    case "markdown":
      return "markdown";
    case "pdf":
      return "pdfs";
    case "manual-note":
      return "txt";
    case "dataset":
      return "datasets";
    default:
      return sourceType;
  }
}

export function normalizeToMarkdown(sourceType: SourceType, text: string): string {
  if (sourceType === "markdown") {
    return text.trim();
  }
  if (sourceType === "html") {
    return htmlToMarkdown(text);
  }
  return text.trim();
}
