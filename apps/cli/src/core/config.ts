import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "./schemas.js";

export function defaultConfig(now = new Date()): WorkspaceConfig {
  const timestamp = now.toISOString();
  return WorkspaceConfigSchema.parse({
    workspace_name: "knowledge-system",
    privacy_mode: "local_first",
    default_privacy_level: "private",
    created_at: timestamp,
    updated_at: timestamp,
    portal: {
      title: "ASSIMILATOR Knowledge Portal"
    },
    memory: {
      export_targets: ["hermes", "hindsight", "jsonl"]
    }
  });
}

export async function readConfig(workspace: string): Promise<WorkspaceConfig> {
  const configPath = path.join(workspace, "assimilator.config.yaml");
  const raw = await fs.readFile(configPath, "utf8");
  return WorkspaceConfigSchema.parse(YAML.parse(raw));
}

export function serializeConfig(config: WorkspaceConfig): string {
  return YAML.stringify(config);
}
