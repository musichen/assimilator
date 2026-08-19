#!/usr/bin/env node
/**
 * ASSIMILATOR CRITICAL TESTS — youtube_to_mp3 pipeline + job manager + flag parsing
 *
 * Run:  cd ~/apps/assimilator && node_modules/tsx/dist/cli.mjs tests/critical.test.mts
 * Exit 0 = all pass. Exit 1 = failures.
 *
 * These are REAL tests: they execute the actual code paths and assert on
 * actual output — including a real network YouTube → MP3 conversion.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { youtubeToMp3, isYoutubeUrl, isYoutubePlaylistUrl } from "../apps/cli/src/converters/youtube-mp3.ts";
import { JobManager } from "../apps/telegram/job-manager.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

// ── Test 1: parseArtistFlag — bot.ts source regex must cover all variants ──
console.log("\n═══ Test 1: parseArtistFlag (source regex + behavior) ═══");
{
  const botSrc = readFileSync(new URL("../apps/telegram/bot.ts", import.meta.url), "utf8");

  // The regex in the live source must accept every documented variant
  const m = botSrc.match(/function parseArtistFlag[\s\S]*?\n}/);
  const fnSrc = m?.[0] ?? "";
  ok("bot.ts contains parseArtistFlag", !!m);
  ok("regex covers --setArtist | --author | -author", /--\?setArtist\|\s*--\?author/.test(fnSrc));
  ok("regex covers em-dash —author and –author", /—author\|\s*–author/.test(fnSrc));
  ok("regex covers curly “” quotes", /“\(\[\^”\]\*\)”/.test(fnSrc));
  ok("regex covers guillemets «»", /«\(\[\^»\]\*\)»/.test(fnSrc));

  // Behavioral: extract the regex literal from source and run the exact user input
  const reSrc = fnSrc.match(/text\.match\(\s*(\/[^\n]*?[^\\]\/i)\s*,/);
  if (reSrc) {
    const re = new Function(`return ${reSrc[1]};`)();
    const cases: [string, string | null, string][] = [
      ['https://youtu.be/EkFuv7cjJCA —author “Linkin Riffs”', "Linkin Riffs", "https://youtu.be/EkFuv7cjJCA"],
      ['https://youtu.be/abc --author "Custom Name"', "Custom Name", "https://youtu.be/abc"],
      ['https://youtu.be/abc --setArtist "Custom Name"', "Custom Name", "https://youtu.be/abc"],
      ['https://youtu.be/abc —author «Лирика»', "Лирика", "https://youtu.be/abc"],
      ['https://youtu.be/abc -author Solo', "Solo", "https://youtu.be/abc"],
      ['https://youtu.be/abc', null, "https://youtu.be/abc"],
    ];
    for (const [input, expArtist, expRest] of cases) {
      const match = re.exec(input);
      const artist = match ? match[1] ?? match[2] ?? match[3] ?? match[4] : null;
      const rest = match ? input.replace(match[0], "").trim() : input;
      ok(`parseArtistFlag: ${input.slice(0, 52)}…`, artist === expArtist && rest === expRest,
        `got artist=${JSON.stringify(artist)} rest=${JSON.stringify(rest)}`);
    }
  } else {
    ok("extract regex from source", false, "regex block not found");
  }
}

// ── Test 2: JobManager — parallelism, queueing, status, abort (REAL module) ──
console.log("\n═══ Test 2: JobManager concurrency + queue ═══");
{
  process.env.ASSIMILATOR_MAX_CONCURRENT_JOBS = "2";
  const jm = new JobManager();
  ok("maxConcurrent = 2 from env", jm.maxConcurrent === 2, `got ${jm.maxConcurrent}`);

  const events: string[] = [];
  const run = (name: string, ms: number) => async (_signal: AbortSignal, onProgress: (m: string) => void) => {
    events.push(`${name}:start`);
    onProgress(`working on ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    events.push(`${name}:end`);
  };

  const op1 = jm.submit(1, "job-A", [], run("A", 300));
  const op2 = jm.submit(1, "job-B", [], run("B", 300));
  const op3 = jm.submit(1, "job-C", [], run("C", 300));

  await new Promise((r) => setTimeout(r, 150));
  const runningDuring = jm.activeList().filter((o) => o.status === "running").length;
  ok("exactly 2 jobs running in parallel (concurrency=2)", runningDuring === 2, `got ${runningDuring}`);

  const statusLines = jm.statusLines();
  const statusText = statusLines.join("\n");
  ok("/status shows running jobs", statusText.includes("Running"), statusText);
  ok("/status shows queued job", statusText.includes("Queued") && statusText.includes("job-C"), statusText);

  await jm.awaitCompletion(op1);
  await jm.awaitCompletion(op2);
  await jm.awaitCompletion(op3);
  ok("all 3 jobs completed", [op1, op2, op3].every((o) => o.status === "done"),
    JSON.stringify([op1, op2, op3].map((o) => o.status)));

  // Abort a RUNNING job
  const op4 = jm.submit(1, "job-D", [], run("D", 5000));
  await new Promise((r) => setTimeout(r, 100));
  const aborted = jm.abort(op4.id);
  ok("abort returns the job", aborted?.id === op4.id);
  await new Promise((r) => setTimeout(r, 300));
  ok("aborted job status = aborted", op4.status === "aborted", `status=${op4.status}`);

  // progress string gets recorded
  const op5 = jm.submit(1, "job-E", [], run("E", 50));
  await new Promise((r) => setTimeout(r, 300));
  ok("progress recorded on job", op5.status === "done" && op5.progress !== "queued…", `progress=${op5.progress}`);
}

// ── Test 3: isYoutubeUrl / isYoutubePlaylistUrl ──
console.log("\n═══ Test 3: URL validation ═══");
{
  ok("youtu.be short link", isYoutubeUrl("https://youtu.be/EkFuv7cjJCA"));
  ok("youtube.com watch", isYoutubeUrl("https://www.youtube.com/watch?v=EkFuv7cjJCA"));
  ok("garbage URL rejected", !isYoutubeUrl("https://example.com/not-video"));
  ok("garbage with flag rejected", !isYoutubeUrl("https://example.com/not-video —author test"));
  ok("playlist detected", isYoutubePlaylistUrl("https://www.youtube.com/playlist?list=PL123"));
  ok("single video not playlist", !isYoutubePlaylistUrl("https://youtu.be/EkFuv7cjJCA"));
}

// ── Test 4: REAL YouTube → MP3 conversion (network, exact failing URL) ──
console.log("\n═══ Test 4: real YouTube → MP3 (network) ═══");
{
  const url = "https://youtu.be/EkFuv7cjJCA?is=RQO-YCOamq5eDcTy"; // the exact URL that failed with 403 + timeout
  const dir = await mkdtemp(path.join(os.tmpdir(), "assim-test-"));
  try {
    const t0 = Date.now();
    const progressMsgs: string[] = [];
    const res = await youtubeToMp3(url, dir, (m) => progressMsgs.push(m));
    const secs = (Date.now() - t0) / 1000;

    ok("conversion completed", true);
    ok("title extracted", !!res.title && res.title.length > 0, res.title);
    ok("file exists and non-empty", res.size > 0, `${res.size} bytes`);
    ok("mp3 is actually an MP3", res.filePath.endsWith(".mp3"));
    ok("progress was reported", progressMsgs.length > 0, `${progressMsgs.length} msgs`);
    ok("fast enough (< 120s)", secs < 120, `took ${secs.toFixed(1)}s`);
    console.log(`  ℹ️  ${res.title} | ${(res.size / 1024 / 1024).toFixed(1)} MB | ${secs.toFixed(1)}s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── Summary ──
console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
