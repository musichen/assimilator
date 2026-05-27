import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-smoke-"));
  const workspace = path.join(root, "knowledge-system");
  const notes = path.join(root, "notes");
  const books = path.join(root, "books");
  const repo = path.join(root, "repo");
  await fs.mkdir(notes, { recursive: true });
  await fs.mkdir(books, { recursive: true });
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(notes, "memory-note.md"), "# Hermes Memory\n\nHermes memory should stay source-linked.");
  await fs.writeFile(path.join(notes, "article.html"), "<h1>HTML Import</h1><p><strong>Showdown</strong> converts HTML.</p>");
  await fs.writeFile(path.join(books, "Ada Lovelace - Computing Notes.txt"), "sample book");
  await fs.writeFile(path.join(books, "Ada Lovelace - Computing Notes.epub"), "sample inventory book");
  await fs.writeFile(path.join(repo, "README.md"), "# Repo Knowledge\n\nASSIMILATOR can ingest local repo notes.");

  const commands: string[][] = [
    ["init"],
    ["status"],
    ["convert", "--file", path.join(notes, "memory-note.md")],
    ["ingest-file", path.join(notes, "memory-note.md"), "--tag", "hermes"],
    ["ingest-folder", notes],
    ["ingest-book", path.join(books, "Ada Lovelace - Computing Notes.txt")],
    ["ingest-repo", repo],
    ["process-inbox"],
    ["compile-wiki"],
    ["render-portal"],
    ["search", "Hermes"],
    ["ask", "Hermes memory"],
    ["suggest-concepts"],
    ["suggest-links"],
    ["daily-log", "--date", "2026-05-27", "--priority", "Smoke test ASSIMILATOR"],
    ["memory-export"],
    ["hindsight-export"],
    ["inventory-library", books],
    ["health-check"]
  ];

  for (const args of commands) {
    const label = `pnpm -s assimilate --workspace ${workspace} ${args.join(" ")}`;
    process.stdout.write(`\n$ ${label}\n`);
    const { stdout, stderr } = await execFileAsync("pnpm", ["-s", "assimilate", "--workspace", workspace, ...args], {
      cwd: path.resolve("."),
      maxBuffer: 1024 * 1024 * 10
    });
    if (stdout.trim()) process.stdout.write(`${stdout.trim()}\n`);
    if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
  }

  process.stdout.write(`\nSmoke workspace: ${workspace}\n`);
  process.stdout.write("ASSIMILATOR smoke test completed.\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
