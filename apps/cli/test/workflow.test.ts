import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace } from "../src/core/workspace.js";
import { ingestFile, ingestFolder, processInbox } from "../src/core/ingest.js";
import { getWorkspaceStatus } from "../src/core/status.js";
import { renderPortal } from "../src/portal/render.js";
import { searchWorkspace } from "../src/search/search.js";
import { askLocal } from "../src/search/ask.js";
import { exportMemoryCards } from "../src/memory/export.js";
import { runHealthCheck } from "../src/health/checker.js";
import { writeDailyLog } from "../src/wiki/daily-log.js";
import { suggestConcepts, suggestLinks } from "../src/wiki/suggestions.js";
import { inventoryLibrary } from "../src/library/inventory.js";

describe("ASSIMILATOR MVP workflow", () => {
  it("initializes, ingests, renders, searches, exports memory, and checks health", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-"));
    const workspace = path.join(root, "knowledge-system");
    const sourcePath = path.join(root, "hermes-note.md");
    await fs.writeFile(sourcePath, [
      "# Hermes Memory Wiki",
      "",
      "Hermes should keep daily logs and source-linked memory cards.",
      "https://example.com/reference",
      "assimilate memory-export",
      "What should Hermes remember tomorrow?"
    ].join("\n"));

    const init = await initWorkspace(workspace);
    expect(init.createdFiles).toContain("assimilator.config.yaml");

    const ingest = await ingestFile(workspace, sourcePath, { tags: ["hermes"] });
    expect(ingest.metadata.source_type).toBe("markdown");
    expect(await fs.readFile(path.join(workspace, ingest.metadata.local_raw_path), "utf8")).toContain("Hermes Memory Wiki");
    expect(await fs.readFile(ingest.processedMarkdownPath, "utf8")).toContain("## Notes for Hermes");

    const status = await getWorkspaceStatus(workspace);
    expect(status.initialized).toBe(true);
    expect(status.counts.metadata).toBe(1);
    expect(status.counts.wikiPages).toBeGreaterThan(1);

    const matches = await searchWorkspace(workspace, "memory cards");
    expect(matches.some((match) => match.file.endsWith(".md"))).toBe(true);

    const portal = await renderPortal(workspace);
    expect(portal.pagesRendered).toBeGreaterThan(1);
    expect(await fs.readFile(portal.indexPath, "utf8")).toContain("ASSIMILATOR Knowledge Portal");

    const memory = await exportMemoryCards(workspace);
    expect(memory.cards).toHaveLength(1);
    expect(await fs.readFile(memory.hermesPath, "utf8")).toContain("source_reference");

    const health = await runHealthCheck(workspace);
    expect(health.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("supports folder, inbox, daily-log, ask, suggestions, and library inventory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-ops-"));
    const workspace = path.join(root, "knowledge-system");
    await initWorkspace(workspace);

    const folder = path.join(root, "notes");
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, "agent-memory.txt"), "Hermes memory should be source linked.");
    const folderResults = await ingestFolder(workspace, folder, { tags: ["folder"] });
    expect(folderResults).toHaveLength(1);

    const inboxDrop = path.join(workspace, "inbox", "drop");
    await fs.writeFile(path.join(inboxDrop, "inbox-note.md"), "# Inbox Note\n\nHindsight export needs review.");
    const inboxResults = await processInbox(workspace);
    expect(inboxResults).toHaveLength(1);

    const daily = await writeDailyLog(workspace, { date: "2026-05-27", priority: "Ship ASSIMILATOR MVP", note: "Finalize local-first commands." });
    expect(await fs.readFile(daily.path, "utf8")).toContain("Ship ASSIMILATOR MVP");

    const answer = await askLocal(workspace, "Hindsight");
    expect(answer.answer).toContain("Local evidence found");

    const concepts = await suggestConcepts(workspace);
    expect(concepts.length).toBeGreaterThan(0);
    const links = await suggestLinks(workspace);
    expect(links.length).toBeGreaterThan(0);

    const books = path.join(root, "books");
    await fs.mkdir(books);
    await fs.writeFile(path.join(books, "Ada Lovelace - Notes on Computing.epub"), "sample");
    const inventory = await inventoryLibrary(workspace, books);
    expect(inventory.items).toHaveLength(1);
    expect(await fs.readFile(inventory.markdownPath, "utf8")).toContain("inventory only");
  });
});
