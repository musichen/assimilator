import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { convertAnything } from "../cli/src/core/convert.js";
import { resolveWorkspace } from "../cli/src/core/paths.js";
import { initWorkspace } from "../cli/src/core/workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: path.join(process.cwd(), ".tmp", "uploads"), limits: { fileSize: 100 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 4321);
const workspace = resolveWorkspace(process.env.ASSIMILATOR_WORKSPACE ?? "knowledge-system");

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/convert/file", upload.single("file"), async (req, res) => {
  try {
    await initWorkspace(workspace);
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }
    const originalPath = path.join(path.dirname(req.file.path), req.file.originalname);
    await fs.rename(req.file.path, originalPath);
    const result = await convertAnything({ filePath: originalPath, workspace, title: req.body.title });
    res.json(publicResult(result));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/convert/url", async (req, res) => {
  try {
    await initWorkspace(workspace);
    const url = String(req.body.url ?? "");
    if (!/^https?:\/\//.test(url)) {
      res.status(400).json({ error: "Provide an http(s) URL." });
      return;
    }
    const result = await convertAnything({ url, workspace, title: req.body.title });
    res.json(publicResult(result));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/conversions", async (_req, res) => {
  try {
    const convertedRoot = path.join(workspace, "converted");
    const entries = await fs.readdir(convertedRoot, { withFileTypes: true }).catch(() => []);
    const conversions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(convertedRoot, entry.name);
      const metadataPath = path.join(dir, `${entry.name}.json`);
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
      conversions.push(metadata);
    }
    res.json({ conversions });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(port, () => {
  console.log(`ASSIMILATOR web converter: http://localhost:${port}`);
  console.log(`Workspace: ${workspace}`);
});

function publicResult(result: Awaited<ReturnType<typeof convertAnything>>) {
  return {
    id: result.id,
    title: result.title,
    sourceType: result.sourceType,
    source: result.source,
    markdown: result.markdown,
    html: result.html,
    markdownPath: result.markdownPath,
    htmlPath: result.htmlPath,
    metadataPath: result.metadataPath
  };
}
