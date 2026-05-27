import fs from "node:fs/promises";
import path from "node:path";

export async function appendJsonl(workspace: string, logName: "ingestion" | "processing" | "errors", record: Record<string, unknown>): Promise<void> {
  const filePath = path.join(workspace, "logs", `${logName}.jsonl`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify({ ...record, logged_at: new Date().toISOString() })}\n`);
}
