import fs from "node:fs/promises";
import path from "node:path";
import { readConfig } from "./config.js";
import { extractSignals } from "./extract.js";
import { listFiles, uniquePath } from "./fs.js";
import { hashFile } from "./hashing.js";
import { hashText } from "./hashing.js";
import { slugify, sourceId } from "./ids.js";
import { appendJsonl } from "./logger.js";
import { buildMarkdownArtifact } from "./markdown.js";
import { relativeToWorkspace } from "./paths.js";
import { SourceMetadataSchema, type SourceMetadata, type SourceType } from "./schemas.js";
import { rawDirectoryForSourceType } from "../converters/passthrough.js";
import { convertLocalFileToMarkdown } from "../converters/source-converter.js";
import { convertRemoteToMarkdown } from "../converters/remote-converter.js";
import { ensureConceptPages, updateWikiIndexes, writeWikiSourcePage } from "../wiki/indexes.js";

export interface IngestFileOptions {
  title?: string;
  privacyLevel?: SourceMetadata["privacy_level"];
  tags?: string[];
}

export interface IngestResult {
  metadata: SourceMetadata;
  processedMarkdownPath: string;
  wikiPath: string;
}

export async function ingestFile(workspace: string, inputPath: string, options: IngestFileOptions = {}): Promise<IngestResult> {
  const absoluteInput = path.resolve(inputPath);
  const stat = await fs.stat(absoluteInput);
  if (!stat.isFile()) {
    throw new Error(`Input is not a file: ${inputPath}`);
  }
  const config = await readConfig(workspace);
  const hash = await hashFile(absoluteInput);
  const id = sourceId(hash);
  const conversion = await convertLocalFileToMarkdown(absoluteInput);
  const title = slugify(options.title ?? conversion.title ?? path.basename(absoluteInput, path.extname(absoluteInput)));
  const rawDir = path.join(workspace, "raw", rawDirectoryForSourceType(conversion.sourceType));
  await fs.mkdir(rawDir, { recursive: true });
  const rawPath = await uniquePath(path.join(rawDir, `${title}${path.extname(absoluteInput) || ".txt"}`));
  await fs.copyFile(absoluteInput, rawPath);

  return writeIngestedMarkdown(workspace, {
    id,
    sourceType: conversion.sourceType,
    title,
    hash,
    rawPath,
    markdown: conversion.markdown,
    privacyLevel: options.privacyLevel ?? config.default_privacy_level,
    tags: options.tags ?? [],
    warnings: conversion.warnings,
    event: "ingest_file",
    input: absoluteInput
  });
}

export async function ingestUrl(workspace: string, url: string, options: IngestFileOptions = {}): Promise<IngestResult> {
  const normalizedUrl = normalizeUrl(url);
  const config = await readConfig(workspace);
  const conversion = await convertRemoteToMarkdown(normalizedUrl);
  const markdown = conversion.markdown.trim();
  const hash = hashText(`${normalizedUrl}\n${markdown}`);
  const id = sourceId(hash);
  const parsedUrl = new URL(normalizedUrl);
  const title = slugify(options.title ?? conversion.title ?? parsedUrl.hostname + parsedUrl.pathname.replace(/\//g, "-"));
  const rawDir = path.join(workspace, "raw", conversion.sourceType === "youtube" ? "youtube" : "web");
  await fs.mkdir(rawDir, { recursive: true });
  const rawPath = await uniquePath(path.join(rawDir, `${title}.md`));
  await fs.writeFile(rawPath, markdown);

  return writeIngestedMarkdown(workspace, {
    id,
    sourceType: conversion.sourceType,
    title,
    hash,
    rawPath,
    markdown,
    sourceUrl: normalizedUrl,
    privacyLevel: options.privacyLevel ?? config.default_privacy_level,
    tags: options.tags ?? [],
    warnings: conversion.warnings,
    event: "ingest_url",
    input: normalizedUrl
  });
}

export async function ingestFolder(workspace: string, folderPath: string, options: IngestFileOptions = {}): Promise<IngestResult[]> {
  const absoluteFolder = path.resolve(folderPath);
  const files = (await listFiles(absoluteFolder)).filter((filePath) => isIngestiblePath(filePath));
  const results: IngestResult[] = [];
  for (const filePath of files) {
    results.push(await ingestFile(workspace, filePath, options));
  }
  return results;
}

export async function processInbox(workspace: string): Promise<IngestResult[]> {
  const inboxRoots = [
    path.join(workspace, "inbox", "drop"),
    path.join(workspace, "inbox", "manual-notes"),
    path.join(workspace, "inbox", "articles")
  ];
  const results: IngestResult[] = [];
  for (const root of inboxRoots) {
    const files = (await listFiles(root)).filter((filePath) => isIngestiblePath(filePath));
    for (const filePath of files) {
      results.push(await ingestFile(workspace, filePath, { tags: ["inbox"] }));
    }
  }
  return results;
}

interface WriteIngestedMarkdownInput {
  id: string;
  sourceType: SourceType;
  title: string;
  hash: string;
  rawPath: string;
  markdown: string;
  sourceUrl?: string;
  privacyLevel: SourceMetadata["privacy_level"];
  tags: string[];
  warnings: string[];
  event: string;
  input: string;
}

async function writeIngestedMarkdown(workspace: string, input: WriteIngestedMarkdownInput): Promise<IngestResult> {
  const normalizedMarkdown = input.markdown;
  const signals = extractSignals(normalizedMarkdown);
  const timestamp = new Date().toISOString();
  const processedMarkdownPath = path.join(workspace, "processed", "markdown", `${input.title}.md`);
  const metadataPath = path.join(workspace, "processed", "metadata", `${input.id}.json`);

  const metadata = SourceMetadataSchema.parse({
    id: input.id,
    source_type: input.sourceType,
    title: input.title,
    source_url: input.sourceUrl,
    local_raw_path: relativeToWorkspace(workspace, input.rawPath),
    processed_markdown_path: relativeToWorkspace(workspace, processedMarkdownPath),
    created_at: timestamp,
    ingested_at: timestamp,
    updated_at: timestamp,
    tags: input.tags,
    summary_short: signals.summaryShort,
    summary_long: signals.keyIdeas.join(" "),
    related_concepts: signals.concepts,
    confidence: "medium",
    freshness: "fresh",
    privacy_level: input.privacyLevel,
    license_or_rights_notes: "",
    processing_status: "processed",
    errors: input.warnings,
    hash: input.hash
  });

  const artifact = buildMarkdownArtifact(metadata, normalizedMarkdown, signals);
  await fs.mkdir(path.dirname(processedMarkdownPath), { recursive: true });
  await fs.writeFile(processedMarkdownPath, artifact);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const wikiPath = await writeWikiSourcePage(workspace, metadata, artifact);
  await ensureConceptPages(workspace, metadata);
  await updateWikiIndexes(workspace);
  await appendJsonl(workspace, "ingestion", {
    event: input.event,
    source_id: input.id,
    input: input.input,
    raw_path: metadata.local_raw_path,
    processed_markdown_path: metadata.processed_markdown_path
  });

  return { metadata, processedMarkdownPath, wikiPath };
}

function isIngestiblePath(filePath: string): boolean {
  const normalized = filePath.split(path.sep);
  if (normalized.some((part) => [".git", "node_modules", "dist", ".next"].includes(part))) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".md", ".markdown", ".txt", ".html", ".htm", ".pdf", ".epub", ".mobi", ".docx",
    ".csv", ".tsv", ".json", ".yaml", ".yml", ".xlsx", ".jpg", ".jpeg", ".png", ".gif",
    ".webp", ".mp3", ".wav", ".m4a", ".flac"
  ].includes(ext);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\\([?&=])/g, "$1");
}
