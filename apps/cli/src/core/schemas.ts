import { z } from "zod";

export const SourceTypeSchema = z.enum([
  "url",
  "youtube",
  "pdf",
  "epub",
  "mobi",
  "docx",
  "txt",
  "markdown",
  "html",
  "image",
  "audio",
  "repo",
  "folder",
  "dataset",
  "chat",
  "manual-note"
]);

export const PrivacyLevelSchema = z.enum(["public", "internal", "private", "sensitive"]);
export const PrivacyModeSchema = z.enum([
  "local_first",
  "external_llm_allowed",
  "metadata_only",
  "ask_before_external",
  "project_public"
]);

export const ProcessingStatusSchema = z.enum(["pending", "processed", "failed", "needs_review"]);

export const WorkspaceConfigSchema = z.object({
  workspace_name: z.string().min(1),
  privacy_mode: PrivacyModeSchema.default("local_first"),
  default_privacy_level: PrivacyLevelSchema.default("private"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  portal: z.object({
    title: z.string().min(1).default("ASSIMILATOR Knowledge Portal")
  }),
  memory: z.object({
    export_targets: z.array(z.enum(["hermes", "hindsight", "jsonl"])).default(["hermes", "hindsight", "jsonl"])
  })
});

export const SourceMetadataSchema = z.object({
  id: z.string().min(1),
  source_type: SourceTypeSchema,
  title: z.string().min(1),
  author: z.string().optional(),
  source_url: z.string().url().optional(),
  local_raw_path: z.string().min(1),
  processed_markdown_path: z.string().min(1),
  processed_html_path: z.string().optional(),
  created_at: z.string().datetime(),
  ingested_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tags: z.array(z.string()).default([]),
  language: z.string().optional(),
  summary_short: z.string().default(""),
  summary_long: z.string().default(""),
  related_projects: z.array(z.string()).default([]),
  related_topics: z.array(z.string()).default([]),
  related_concepts: z.array(z.string()).default([]),
  related_people: z.array(z.string()).default([]),
  related_tools: z.array(z.string()).default([]),
  related_companies: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  freshness: z.enum(["fresh", "stale", "unknown"]).default("unknown"),
  privacy_level: PrivacyLevelSchema.default("private"),
  license_or_rights_notes: z.string().default(""),
  processing_status: ProcessingStatusSchema.default("processed"),
  errors: z.array(z.string()).default([]),
  hash: z.string().min(1),
  duplicate_of: z.string().optional()
});

export const MemoryCardSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "fact",
    "insight",
    "decision",
    "project-context",
    "technical-insight",
    "open-loop",
    "workflow",
    "command",
    "risk",
    "preference"
  ]),
  content: z.string().min(1),
  source_id: z.string().min(1),
  source_reference: z.string().min(1),
  related_projects: z.array(z.string()).default([]),
  related_concepts: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  privacy_level: PrivacyLevelSchema.default("private"),
  created_at: z.string().datetime()
});

export type SourceType = z.infer<typeof SourceTypeSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;
export type MemoryCard = z.infer<typeof MemoryCardSchema>;
