import fs from "node:fs/promises";
import path from "node:path";

export interface DailyLogOptions {
  date?: string;
  priority?: string;
  note?: string;
}

export interface DailyLogResult {
  path: string;
  created: boolean;
}

export async function writeDailyLog(workspace: string, options: DailyLogOptions = {}): Promise<DailyLogResult> {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const filePath = path.join(workspace, "wiki", "daily-logs", `${date}.md`);
  const priority = options.priority ?? "";
  const note = options.note ?? "";
  let created = false;

  try {
    await fs.access(filePath);
  } catch {
    created = true;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, [
      "---",
      `title: ${date}`,
      "type: daily-log",
      `date: ${date}`,
      "status: active",
      "---",
      "",
      `# ${date}`,
      "",
      "## Main Priority",
      "",
      priority || "_Not set yet._",
      "",
      "## Tasks Discussed",
      "",
      "- None yet.",
      "",
      "## Tasks Delegated to Hermes",
      "",
      "- None yet.",
      "",
      "## Tasks Completed",
      "",
      "- None yet.",
      "",
      "## Decisions",
      "",
      "- None yet.",
      "",
      "## Memories Updated",
      "",
      "- None yet.",
      "",
      "## Related Subjects",
      "",
      "- None yet.",
      "",
      "## Follow-ups",
      "",
      "- None yet.",
      "",
      "## Notes",
      "",
      note || "_No notes yet._",
      ""
    ].join("\n"));
    return { path: filePath, created };
  }

  const additions = [
    "",
    `## Update ${new Date().toISOString()}`,
    "",
    priority ? `Priority: ${priority}` : "",
    note ? `Note: ${note}` : "",
    ""
  ].filter(Boolean).join("\n");
  if (additions.trim()) {
    await fs.appendFile(filePath, additions);
  }
  return { path: filePath, created };
}
