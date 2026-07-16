# ASSIMILATOR Multithread-or-Queue Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let Alex send multiple URLs/files to the Telegram ASSIMILATOR bot back-to-back without the second request aborting or blocking behind the first message handler.

**Architecture:** Add a Telegram-side operation queue with a small worker pool. The default user experience stays simple: Alex sends a URL or uploads a file, the bot immediately creates a job, replies with a job id/status message, and processes the job in the background. Start safely with `maxConcurrent=1` queueing, then allow controlled parallelism via config/env and `/queue parallel <n>` once workspace writes are protected.

**Tech Stack:** Node.js/TypeScript, `node-telegram-bot-api`, existing ASSIMILATOR CLI core (`ingestUrl`, `ingestFile`, `retainInHindsight`, wiki index updates), `AbortController`, append-only JSONL logs, Vitest.

---

## 1. Current implementation findings

### Existing Telegram flow

Key file: `apps/telegram/bot.ts`

Relevant current paths:

- Plain URL text handler: `bot.on("message", ...)` calls `convertUrlForChat(chatId, url)`.
- `/convert_url <url>` handler calls `convertUrlForChat(message.chat.id, url)`.
- Uploaded documents/media handlers download to `.tmp/telegram/<chatId>/...`, then call `ingestTelegramLocalFile(...)`.
- `convertUrlForChat(...)` and `ingestTelegramLocalFile(...)` call `runTracked(...)`.
- `runTracked(...)` calls `trackOperation(...)`.
- `trackOperation(...)` stores one global `currentOp` and intentionally aborts any previous operation:

```ts
function trackOperation(description: string, ...outputDirs: string[]): { signal: AbortSignal } {
  // Abort previous op if still running
  if (currentOp) {
    currentOp.controller.abort();
  }
  const controller = new AbortController();
  currentOp = { controller, description, outputDirs, startedAt: Date.now() };
  return { signal: controller.signal };
}
```

### Why this blocks the requested UX

The main problem is not Telegram polling. `node-telegram-bot-api` can receive the second update while the first async handler is still running.

The blocker is ASSIMILATOR’s single global operation model:

1. First URL/file starts and becomes `currentOp`.
2. Second URL/file starts and calls `trackOperation(...)`.
3. `trackOperation(...)` aborts the first operation.
4. `/stop` can only refer to one global operation, not one job or one chat queue.

### Shared resources that make unlimited parallelism risky

Core ingestion writes shared workspace files:

- `apps/cli/src/core/ingest.ts`
  - raw archive under `raw/...`
  - processed Markdown under `processed/markdown/<title>.md`
  - metadata under `processed/metadata/<id>.json`
  - wiki page under `wiki/articles/<title>.md`
  - indexes via `updateWikiIndexes(workspace)`
  - ingestion log via `appendJsonl(...)`
- `apps/cli/src/wiki/indexes.ts`
  - rewrites `wiki/indexes/All Sources.md`
  - rewrites `wiki/indexes/All Concepts.md`
  - rewrites `wiki/indexes/Home.md`
  - rewrites `wiki/indexes/Recently Updated.md`
- `apps/cli/src/core/hindsight.ts`
  - copies into `~/.hindsight/memory-imports/knowledgebase/assimilator/...`
  - shells out to `hindsight memory retain-files ... --async`

This means full parallel ingestion can race on indexes and same-title output paths. Queue-first is the correct minimal safe approach.

---

## 2. Recommended product behavior

### Default UX

Alex can simply send things quickly:

```txt
https://example.com/article-1
https://example.com/article-2
<upload PDF>
<upload voice note>
```

The bot replies immediately for each item:

```txt
📥 Queued #q_20260716_001
Position: 1
Mode: queue
Source: https://example.com/article-1
```

Then, independently:

```txt
▶️ Started #q_20260716_001 — converting URL...
✅ Done #q_20260716_001 — Ingest complete (42s)
```

### Commands

Add these commands, keeping them optional:

```txt
/queue                  show active + pending jobs for this chat
/queue all              show all jobs visible to this bot process
/queue status <jobId>   show one job
/queue cancel <jobId>   cancel pending/running job
/queue retry <jobId>    retry failed/cancelled job
/queue parallel <n>     set runtime worker concurrency, clamped by env max
/stop                   alias for cancelling the newest running job in this chat
/stop <jobId>           cancel a specific job
```

### Safe defaults

Environment variables:

```bash
ASSIMILATOR_QUEUE_CONCURRENCY=1          # safest default
ASSIMILATOR_QUEUE_MAX_CONCURRENCY=2      # hard upper bound for Telegram runtime
ASSIMILATOR_QUEUE_STATE_DIR=.tmp/queue   # process-local durable state
ASSIMILATOR_QUEUE_NOTIFY_ALL=false       # only notify originating chat by default
```

Recommended initial production setting:

```bash
ASSIMILATOR_QUEUE_CONCURRENCY=1
```

Reason: this immediately fixes the user experience. Alex can throw many items at the bot; the bot accepts them instantly and processes reliably one after another. Parallelism can be switched on after write locks are implemented and tested.

---

## 3. Core design

### Job model

Create `apps/telegram/queue.ts`.

```ts
export type QueueJobKind = "convert_url" | "ingest_file" | "youtube_to_mp3" | "youtube_playlist_to_mp3";

export type QueueJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueueJobBase {
  id: string;
  chatId: number;
  messageId?: number;
  kind: QueueJobKind;
  description: string;
  status: QueueJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: string;
  error?: string;
  outputFiles: string[];
  cleanupDirs: string[];
}

export interface ConvertUrlJob extends QueueJobBase {
  kind: "convert_url";
  payload: { url: string };
}

export interface IngestFileJob extends QueueJobBase {
  kind: "ingest_file";
  payload: {
    localPath: string;
    sourceLabel: string;
    forceTranscribe?: boolean;
  };
}

export interface YoutubeToMp3Job extends QueueJobBase {
  kind: "youtube_to_mp3";
  payload: {
    url: string;
    artist?: string;
  };
}

export interface YoutubePlaylistToMp3Job extends QueueJobBase {
  kind: "youtube_playlist_to_mp3";
  payload: {
    url: string;
    artist?: string;
  };
}

export type QueueJob = ConvertUrlJob | IngestFileJob | YoutubeToMp3Job | YoutubePlaylistToMp3Job;
```

### Queue class

Create a minimal in-process queue first. Do not add Redis/BullMQ yet.

```ts
export interface OperationQueueOptions {
  concurrency: number;
  maxConcurrency: number;
  stateDir: string;
  onJobUpdate?: (job: QueueJob) => Promise<void> | void;
  runJob: (job: QueueJob, signal: AbortSignal) => Promise<void>;
}

export class OperationQueue {
  enqueue(job: QueueJob): QueueJob;
  list(filter?: { chatId?: number; status?: QueueJobStatus }): QueueJob[];
  get(jobId: string): QueueJob | undefined;
  cancel(jobId: string): Promise<boolean>;
  retry(jobId: string): QueueJob;
  setConcurrency(value: number): number;
  start(): void;
  stop(): Promise<void>;
}
```

Implementation notes:

- Keep `pending: QueueJob[]`.
- Keep `running = new Map<string, { job: QueueJob; controller: AbortController }>()`.
- Start workers while `running.size < concurrency` and `pending.length > 0`.
- Persist state to JSON after every transition.
- On bot startup, reload only `queued` jobs. Mark old `running` jobs as `failed` with `error="bot restarted while running"`.
- `cancel(jobId)` removes pending jobs or aborts running jobs.
- `retry(jobId)` clones a failed/cancelled job with a new id.

### Locking model

Add `apps/cli/src/core/locks.ts` before enabling concurrency > 1.

```ts
const locks = new Map<string, Promise<void>>();

export async function withKeyLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, previous.then(() => current));
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}
```

Use locks around shared writes:

- `withKeyLock(`workspace:${workspace}:write`, () => writeIngestedMarkdown(...))`
- or smaller locks later:
  - `workspace:<path>:indexes`
  - `workspace:<path>:metadata:<id>`
  - `workspace:<path>:wiki:<title>`

Phase 1 can skip parallel execution and use queue concurrency 1. Phase 2 should add the workspace lock before allowing concurrency 2.

---

## 4. Implementation tasks

### Task 1: Add queue state types and in-memory worker pool

**Objective:** Introduce testable queue infrastructure without touching Telegram handlers yet.

**Files:**

- Create: `apps/telegram/queue.ts`
- Create: `apps/telegram/test/queue.test.ts`
- Modify: `vitest.config.ts` only if current test include pattern misses `apps/telegram/test/**/*.test.ts`

**Step 1: Write tests**

Test cases:

- enqueue returns a job with `queued` status.
- queue starts at most `concurrency` jobs.
- second job stays queued when `concurrency=1`.
- completed job moves to `completed`.
- cancel pending job marks `cancelled` and never runs.
- cancel running job aborts via `AbortSignal`.

Run:

```bash
pnpm -s vitest run apps/telegram/test/queue.test.ts
```

Expected before implementation: fails because `apps/telegram/queue.ts` does not exist.

**Step 2: Implement `OperationQueue`**

Keep it dependency-free and TypeScript-strict.

**Step 3: Run tests**

```bash
pnpm -s vitest run apps/telegram/test/queue.test.ts
pnpm -s typecheck
```

Expected: queue tests pass; typecheck passes or reveals unrelated pre-existing errors to fix before continuing.

**Step 4: Commit**

```bash
git status --short
git add apps/telegram/queue.ts apps/telegram/test/queue.test.ts vitest.config.ts
git commit -m "feat: add telegram operation queue"
```

---

### Task 2: Replace global `currentOp` with job-scoped tracking

**Objective:** Stop new operations from aborting previous operations.

**Files:**

- Modify: `apps/telegram/bot.ts`
- Test: `apps/telegram/test/queue.test.ts` or new `apps/telegram/test/bot-queue.test.ts`

**Step 1: Remove abort-on-new-operation behavior**

Replace:

```ts
let currentOp: ActiveOperation | null = null;
```

with a job map:

```ts
const activeOperations = new Map<string, ActiveOperation>();
```

But prefer moving this into `OperationQueue` so `bot.ts` only sees jobs.

**Step 2: Change `/stop` semantics**

- `/stop` cancels newest running job for the chat.
- `/stop <jobId>` cancels the specified job.
- If no job exists, reply `No running job for this chat.`

**Step 3: Verify**

Add a fake long-running job test:

1. enqueue job A
2. enqueue job B
3. assert job A was not aborted by enqueueing B

Run:

```bash
pnpm -s vitest run apps/telegram/test/queue.test.ts
pnpm -s typecheck
```

**Step 4: Commit**

```bash
git add apps/telegram/bot.ts apps/telegram/test/queue.test.ts
git commit -m "fix: stop aborting previous telegram operations"
```

---

### Task 3: Queue URL conversion jobs

**Objective:** Make plain URLs and `/convert_url` enqueue instantly instead of processing inline.

**Files:**

- Modify: `apps/telegram/bot.ts`
- Possibly modify: `apps/telegram/queue.ts`

**Step 1: Extract current body of `convertUrlForChat` into a job runner**

Create:

```ts
async function runConvertUrlJob(job: ConvertUrlJob, signal: AbortSignal): Promise<void> {
  const { chatId } = job;
  const { url } = job.payload;
  // existing convertUrlForChat internals, using signal checks and job progress updates
}
```

**Step 2: Make `convertUrlForChat` enqueue only**

```ts
function enqueueConvertUrl(chatId: number, url: string, messageId?: number): QueueJob {
  return queue.enqueue({
    id: createJobId(),
    chatId,
    messageId,
    kind: "convert_url",
    description: `Convert URL: ${url.slice(0, 80)}`,
    status: "queued",
    createdAt: new Date().toISOString(),
    outputFiles: [],
    cleanupDirs: [path.join(workspace, "processed"), tempRoot],
    payload: { url },
  });
}
```

**Step 3: Immediate user reply**

Reply right after enqueue:

```txt
📥 Queued #<jobId>
Position: <n>
Source: <url>
```

**Step 4: Verify manually**

Use a local test bot only if token/environment is available. Otherwise verify with unit tests and typecheck.

Commands:

```bash
pnpm -s vitest run apps/telegram/test/queue.test.ts
pnpm -s typecheck
```

**Step 5: Commit**

```bash
git add apps/telegram/bot.ts apps/telegram/queue.ts apps/telegram/test/queue.test.ts
git commit -m "feat: queue telegram URL conversions"
```

---

### Task 4: Queue uploaded files and media

**Objective:** Uploaded documents, voice, audio, video, and photo should also enqueue immediately after download.

**Files:**

- Modify: `apps/telegram/bot.ts`

**Step 1: Split download from ingestion**

Keep handlers doing the download first because Telegram file links are short-lived and download is usually fast.

Then enqueue:

```ts
function enqueueIngestFile(chatId: number, localPath: string, sourceLabel: string, options: { forceTranscribe?: boolean }): QueueJob
```

**Step 2: Extract current ingestion body**

Move current `ingestTelegramLocalFile(...)` internals into:

```ts
async function runIngestFileJob(job: IngestFileJob, signal: AbortSignal): Promise<void>
```

**Step 3: Verify**

Unit-test with a small temp Markdown file and mocked `runJob` where possible.

Run:

```bash
pnpm -s test
pnpm -s typecheck
```

**Step 4: Commit**

```bash
git add apps/telegram/bot.ts apps/telegram/queue.ts apps/telegram/test/queue.test.ts
git commit -m "feat: queue telegram file ingestion"
```

---

### Task 5: Add `/queue` commands

**Objective:** Give Alex visibility and control after throwing multiple jobs at the bot.

**Files:**

- Modify: `apps/telegram/bot.ts`

**Step 1: Register commands**

Add:

```ts
{ command: "queue", description: "Show/cancel/retry ASSIMILATOR background jobs" },
```

**Step 2: Implement command handler**

Support:

```txt
/queue
/queue all
/queue status <jobId>
/queue cancel <jobId>
/queue retry <jobId>
/queue parallel <n>
```

**Step 3: Format output compactly**

```txt
📋 Queue
Running: 1 / 1
Pending: 3

▶️ q_001 convert_url 1m12s https://...
⏳ q_002 ingest_file pos 1 filename.pdf
⏳ q_003 convert_url pos 2 https://...
```

**Step 4: Verify**

```bash
pnpm -s typecheck
```

**Step 5: Commit**

```bash
git add apps/telegram/bot.ts
git commit -m "feat: add telegram queue commands"
```

---

### Task 6: Persist queue state across bot restarts

**Objective:** A bot restart should not silently forget queued work.

**Files:**

- Modify: `apps/telegram/queue.ts`
- Test: `apps/telegram/test/queue.test.ts`
- Modify: `.gitignore` if needed to ensure `.tmp/queue/` remains ignored

**Step 1: Save state JSON**

Write to:

```txt
.tmp/queue/state.json
```

Persist after each transition:

- queued
- running
- completed
- failed
- cancelled

Use atomic write:

1. write `state.json.tmp`
2. rename to `state.json`

**Step 2: Load state on startup**

Rules:

- `queued` remains `queued`.
- old `running` becomes `failed` with error `bot restarted while running`.
- `completed`, `failed`, `cancelled` stay visible for history.
- cap history to latest 200 jobs to avoid unbounded state growth.

**Step 3: Tests**

- enqueue two jobs
- persist
- construct a new queue from same state dir
- assert queued job is restored
- assert running job is marked failed on restart

**Step 4: Commit**

```bash
git add apps/telegram/queue.ts apps/telegram/test/queue.test.ts .gitignore
git commit -m "feat: persist telegram queue state"
```

---

### Task 7: Add workspace write lock before enabling parallelism

**Objective:** Make `ASSIMILATOR_QUEUE_CONCURRENCY=2` safe enough for normal use.

**Files:**

- Create: `apps/cli/src/core/locks.ts`
- Modify: `apps/cli/src/core/ingest.ts`
- Test: new or existing CLI tests under `apps/cli/test/`

**Step 1: Add lock utility**

Create `withKeyLock` as described above.

**Step 2: Wrap ingestion write phase**

In `ingest.ts`, wrap `writeIngestedMarkdown(...)` calls or the internals of `writeIngestedMarkdown(...)` with:

```ts
return withKeyLock(`workspace:${workspace}:write`, async () => {
  // write processed markdown, metadata, wiki, indexes, append logs
});
```

This keeps expensive conversion/download work parallel but serializes the unsafe workspace commit section.

**Step 3: Add a concurrency test**

Test two simultaneous ingests into the same workspace:

```ts
await Promise.all([
  ingestFile(workspace, fileA),
  ingestFile(workspace, fileB),
]);
```

Assert:

- both metadata files exist
- `All Sources.md` contains both titles
- no exception is thrown

**Step 4: Run tests**

```bash
pnpm -s vitest run apps/cli/test/workflow.test.ts
pnpm -s vitest run apps/telegram/test/queue.test.ts
pnpm -s typecheck
```

**Step 5: Commit**

```bash
git add apps/cli/src/core/locks.ts apps/cli/src/core/ingest.ts apps/cli/test/workflow.test.ts
git commit -m "fix: serialize workspace commit writes"
```

---

### Task 8: Enable controlled parallel workers

**Objective:** Allow actual parallel processing when configured, with queue fallback remaining the default.

**Files:**

- Modify: `apps/telegram/bot.ts`
- Modify: `apps/telegram/queue.ts`
- Modify: `.env.example`

**Step 1: Read env config**

```ts
const queueConcurrency = parsePositiveInt(process.env.ASSIMILATOR_QUEUE_CONCURRENCY, 1);
const queueMaxConcurrency = parsePositiveInt(process.env.ASSIMILATOR_QUEUE_MAX_CONCURRENCY, 2);
```

Clamp runtime values:

```ts
concurrency = Math.min(requested, queueMaxConcurrency);
```

**Step 2: Add `/queue parallel <n>`**

- `/queue parallel 1` returns to queue-only serial mode.
- `/queue parallel 2` runs two jobs at once if env max allows.
- Higher values are rejected unless `ASSIMILATOR_QUEUE_MAX_CONCURRENCY` is increased.

**Step 3: Update `.env.example`**

Add:

```bash
ASSIMILATOR_QUEUE_CONCURRENCY=1
ASSIMILATOR_QUEUE_MAX_CONCURRENCY=2
ASSIMILATOR_QUEUE_STATE_DIR=.tmp/queue
```

**Step 4: Verify**

```bash
pnpm -s test
pnpm -s typecheck
```

**Step 5: Commit**

```bash
git add apps/telegram/bot.ts apps/telegram/queue.ts .env.example
git commit -m "feat: add configurable telegram queue concurrency"
```

---

### Task 9: Queue YouTube MP3 jobs separately

**Objective:** Long `yt-dlp`/`ffmpeg` MP3 jobs should not block URL/document ingestion forever.

**Files:**

- Modify: `apps/telegram/bot.ts`
- Modify: `apps/telegram/queue.ts`

**Design choice:** Either use one shared queue or two lanes:

- `ingest` lane: URL/file ingestion, default concurrency 1
- `media` lane: YouTube MP3, default concurrency 1

Recommended first implementation: one shared queue. Add lanes only if Alex sees MP3 downloads starving normal ingestion.

**Step 1: Extract `/youtube_to_mp3` body to `runYoutubeToMp3Job(...)`**

**Step 2: Extract `/youtube_playlist_to_mp3` body to `runYoutubePlaylistToMp3Job(...)`**

**Step 3: Enqueue from command handlers**

Reply immediately:

```txt
🎵 Queued MP3 job #q_...
```

**Step 4: Commit**

```bash
git add apps/telegram/bot.ts apps/telegram/queue.ts
git commit -m "feat: queue youtube mp3 telegram jobs"
```

---

## 5. Acceptance criteria

### Must pass

- Sending URL A then URL B immediately does not abort URL A.
- Bot replies quickly to URL B with a queued job id.
- `/queue` shows both jobs.
- `/stop <jobId>` cancels only that job.
- `/stop` cancels the newest running job in the current chat.
- Completed jobs still send Markdown/metadata documents as today.
- Failed jobs write an action log entry and are visible in `/queue`.
- Restarting the bot does not lose queued-but-not-started jobs.
- Default concurrency 1 is stable on the live workspace.
- Concurrency 2 does not corrupt `wiki/indexes/*.md` in tests.

### Should not happen

- A new URL should not abort the previous operation.
- `/stop` should not cancel jobs from another chat unless the user provides an explicit id and the bot owner allows it.
- Generated result directories such as `results/` and `apps/telegram/results/` should not be committed.
- The queue should not require Alex to use a special command for normal operation.

---

## 6. Rollout plan

1. Implement queue infrastructure and job-scoped cancellation.
2. Deploy with:

```bash
ASSIMILATOR_QUEUE_CONCURRENCY=1
```

3. Test live UX by sending two short URLs rapidly.
4. Confirm first job is not aborted and second waits in queue.
5. Add workspace lock.
6. Test two simultaneous ingests in Vitest.
7. Raise to:

```bash
ASSIMILATOR_QUEUE_CONCURRENCY=2
```

8. Keep `/queue parallel 1` as an immediate rollback.

---

## 7. Why this is the best fit

A full `worker_threads` design is not the right first step:

- The current expensive work is mostly async I/O, external processes, network fetches, `yt-dlp`, `ffmpeg`, and Hindsight CLI calls, not CPU-bound JavaScript.
- Worker threads would complicate imports, ESM/tsx runtime, Telegram bot access, progress reporting, and cancellation.
- The immediate bug is the global `currentOp` aborting the previous operation.

A queue with configurable worker concurrency gives the best UX/safety tradeoff:

- Alex can throw multiple URLs/files immediately.
- Serial mode is reliable now.
- Parallel mode is a small config change after locks.
- The design remains local-first and dependency-light.
- It matches the existing bot architecture instead of replacing it.

Recommended implementation path: **queue first, worker concurrency second, worker threads only later if profiling proves CPU-bound JavaScript bottlenecks.**
