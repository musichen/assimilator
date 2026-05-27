import path from "node:path";
import { listFiles, pathExists } from "./fs.js";

export interface WorkspaceStatus {
  initialized: boolean;
  counts: {
    raw: number;
    processedMarkdown: number;
    metadata: number;
    wikiPages: number;
    portalPages: number;
    memoryCards: number;
  };
}

export async function getWorkspaceStatus(workspace: string): Promise<WorkspaceStatus> {
  const initialized = await pathExists(path.join(workspace, "assimilator.config.yaml"));
  return {
    initialized,
    counts: {
      raw: await count(path.join(workspace, "raw")),
      processedMarkdown: await count(path.join(workspace, "processed", "markdown"), [".md"]),
      metadata: await count(path.join(workspace, "processed", "metadata"), [".json"]),
      wikiPages: await count(path.join(workspace, "wiki"), [".md"]),
      portalPages: await count(path.join(workspace, "portal"), [".html"]),
      memoryCards: await count(path.join(workspace, "memory", "cards"), [".jsonl", ".json"])
    }
  };
}

async function count(root: string, extensions?: string[]): Promise<number> {
  return (await listFiles(root, extensions ? new Set(extensions) : undefined)).length;
}
