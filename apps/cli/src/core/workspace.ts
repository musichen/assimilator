import fs from "node:fs/promises";
import path from "node:path";
import { defaultConfig, serializeConfig } from "./config.js";
import { requiredWikiIndexes, workspaceDirs } from "./paths.js";
import { writeFileIfMissing } from "./fs.js";

export interface InitResult {
  workspace: string;
  createdDirectories: number;
  createdFiles: string[];
}

export async function initWorkspace(workspace: string): Promise<InitResult> {
  let createdDirectories = 0;
  for (const dir of workspaceDirs) {
    await fs.mkdir(path.join(workspace, dir), { recursive: true });
    createdDirectories += 1;
  }

  const createdFiles: string[] = [];
  const configPath = path.join(workspace, "assimilator.config.yaml");
  if (await writeFileIfMissing(configPath, serializeConfig(defaultConfig())) === "created") {
    createdFiles.push("assimilator.config.yaml");
  }

  const rootIndex = path.join(workspace, "wiki", "index.md");
  if (await writeFileIfMissing(rootIndex, "# ASSIMILATOR Wiki\n\nStart at [[Home]].\n") === "created") {
    createdFiles.push("wiki/index.md");
  }

  for (const title of requiredWikiIndexes) {
    const filePath = path.join(workspace, "wiki", "indexes", `${title}.md`);
    const body = title === "Home"
      ? "# Home\n\n## Recent Sources\n\n_No sources ingested yet._\n\n## Navigation\n\n- [[All Sources]]\n- [[Recently Updated]]\n- [[Needs Review]]\n"
      : `# ${title}\n\n_No entries yet._\n`;
    if (await writeFileIfMissing(filePath, body) === "created") {
      createdFiles.push(path.relative(workspace, filePath));
    }
  }

  return { workspace, createdDirectories, createdFiles };
}
