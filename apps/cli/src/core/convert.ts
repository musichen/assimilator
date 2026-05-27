import fs from "node:fs/promises";
import path from "node:path";
import { convertRemoteToMarkdown } from "../converters/remote-converter.js";
import { convertLocalFileToMarkdown } from "../converters/source-converter.js";
import { markdownToHtml } from "../converters/showdown.js";
import { hashText } from "./hashing.js";
import { slugify, sourceId } from "./ids.js";
import { relativeToWorkspace } from "./paths.js";

export interface ConvertInput {
  filePath?: string;
  url?: string;
  title?: string;
  workspace: string;
  save?: boolean;
  outputDir?: string;
  onProgress?: (message: string) => void;
}

export interface ConvertResult {
  id: string;
  title: string;
  sourceType: string;
  source: string;
  markdown: string;
  html: string;
  markdownPath?: string;
  htmlPath?: string;
  metadataPath?: string;
}

export async function convertAnything(input: ConvertInput): Promise<ConvertResult> {
  if (!input.filePath && !input.url) {
    throw new Error("Provide either filePath or url.");
  }
  if (input.filePath && input.url) {
    throw new Error("Provide only one of filePath or url.");
  }

  input.onProgress?.("Preparing input");
  const converted = input.url
    ? await convertUrl(normalizeUrl(input.url), input.title, input.onProgress)
    : await convertFile(input.filePath as string, input.title, input.onProgress);
  input.onProgress?.("Rendering HTML");
  const html = markdownToHtml(converted.markdown);
  input.onProgress?.("Computing conversion ID");
  const id = sourceId(hashText(`${converted.source}\n${converted.markdown}`));
  const result: ConvertResult = { ...converted, id, html };

  if (input.save !== false) {
    input.onProgress?.("Saving Markdown, HTML, and metadata");
    return saveConversion(input.workspace, result, input.outputDir);
  }
  input.onProgress?.("Conversion complete");
  return result;
}

async function convertFile(filePath: string, title?: string, onProgress?: (message: string) => void): Promise<Omit<ConvertResult, "id" | "html">> {
  const absolute = path.resolve(filePath);
  onProgress?.(`Converting file with local/Markit adapters: ${path.basename(absolute)}`);
  const conversion = await convertLocalFileToMarkdown(absolute);
  const finalTitle = slugify(title ?? conversion.title ?? path.basename(absolute, path.extname(absolute)));
  return {
    title: finalTitle,
    sourceType: conversion.sourceType,
    source: absolute,
    markdown: conversion.markdown
  };
}

async function convertUrl(url: string, title?: string, onProgress?: (message: string) => void): Promise<Omit<ConvertResult, "id" | "html">> {
  onProgress?.(`Converting URL: ${url}`);
  const conversion = await convertRemoteToMarkdown(url, onProgress);
  onProgress?.(`Markdown extracted via ${conversion.converter}`);
  const parsed = new URL(url);
  const finalTitle = slugify(title ?? conversion.title ?? `${parsed.hostname}${parsed.pathname.replace(/\//g, "-")}`);
  return {
    title: finalTitle,
    sourceType: conversion.sourceType,
    source: url,
    markdown: conversion.markdown
  };
}

async function saveConversion(workspace: string, result: ConvertResult, outputDir?: string): Promise<ConvertResult> {
  const root = outputDir ? path.resolve(outputDir) : path.join(workspace, "converted", conversionCategory(result.sourceType), result.title);
  await fs.mkdir(root, { recursive: true });
  const markdownPath = path.join(root, `${result.title}.md`);
  const htmlPath = path.join(root, `${result.title}.html`);
  const metadataPath = path.join(root, `${result.title}.json`);
  await fs.writeFile(markdownPath, result.markdown);
  await fs.writeFile(htmlPath, wrapHtml(result.title, result.html));
  await fs.writeFile(metadataPath, `${JSON.stringify({
    id: result.id,
    title: result.title,
    source_type: result.sourceType,
    source: result.source,
    markdown_path: relativeToWorkspace(workspace, markdownPath),
    html_path: relativeToWorkspace(workspace, htmlPath),
    created_at: new Date().toISOString()
  }, null, 2)}\n`);
  return { ...result, markdownPath, htmlPath, metadataPath };
}

function conversionCategory(sourceType: string): string {
  switch (sourceType) {
    case "youtube":
      return "youtube";
    case "url":
      return "web";
    case "markdown":
      return "markdown";
    case "txt":
      return "text";
    default:
      return slugify(sourceType || "other");
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\\([?&=])/g, "$1");
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { max-width: 880px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    pre, code { background: #f0f1ec; border-radius: 6px; }
    code { padding: 2px 5px; }
    pre { padding: 14px; overflow: auto; }
  </style>
</head>
<body>${body}</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#39;";
    }
  });
}
