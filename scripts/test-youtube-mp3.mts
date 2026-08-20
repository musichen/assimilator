import { youtubeToMp3 } from "../apps/cli/src/converters/youtube-mp3.ts";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-mp3-"));
const t0 = Date.now();
const r = await youtubeToMp3(
  "https://youtu.be/EkFuv7cjJCA?is=RQO-YCOamq5eDcTy",
  dir,
  (m) => console.log("PROG", m),
);
console.log("SUCCESS", JSON.stringify({ title: r.title, size: r.size, file: r.filePath, elapsed_ms: Date.now() - t0 }));
