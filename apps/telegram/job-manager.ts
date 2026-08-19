/**
 * JobManager — parallel job queue with bounded concurrency.
 *
 * Replaces the old single-slot `currentOp` (which ABORTED the previous job
 * whenever a new one started). Now:
 *   - up to `maxConcurrent` jobs run in parallel
 *   - additional jobs wait in the queue
 *   - every job has a status + progress string, visible via /status
 *   - /stop [id] can abort a specific job (or all)
 *
 * Pure module — no Telegram dependency, so tests can import it directly.
 */

export interface ActiveOperation {
  id: number;
  controller: AbortController;
  description: string;
  outputDirs: string[];     // directories whose new files to clean up on abort
  startedAt: number;        // Date.now() — to identify files created during this op
  status: "queued" | "running" | "done" | "failed" | "aborted";
  progress: string;         // human-readable progress (updated by jobs)
  chatId: number;
  run: (signal: AbortSignal, onProgress: (msg: string) => void) => Promise<void>;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
}

export class JobManager {
  private queue: ActiveOperation[] = [];
  private running: ActiveOperation[] = [];
  private nextId = 1;
  readonly maxConcurrent: number;

  constructor() {
    const raw = Number.parseInt(process.env.ASSIMILATOR_MAX_CONCURRENT_JOBS ?? "", 10);
    this.maxConcurrent = Number.isFinite(raw) && raw > 0 ? raw : 2;
  }

  submit(
    chatId: number,
    description: string,
    outputDirs: string[],
    run: (signal: AbortSignal, onProgress: (msg: string) => void) => Promise<void>,
  ): ActiveOperation {
    const op: ActiveOperation = {
      id: this.nextId++,
      controller: new AbortController(),
      description,
      outputDirs,
      startedAt: Date.now(),
      status: "queued",
      progress: "queued…",
      chatId,
      run,
    };
    this.queue.push(op);
    this.pump();
    return op;
  }

  /** Move queued jobs into the running pool up to maxConcurrent. */
  private pump(): void {
    while (this.running.length < this.maxConcurrent && this.queue.length > 0) {
      const op = this.queue.shift()!;
      if (op.controller.signal.aborted) {
        op.status = "aborted";
        continue;
      }
      this.running.push(op);
      op.status = "running";
      void this.execute(op);
    }
  }

  private async execute(op: ActiveOperation): Promise<void> {
    try {
      await op.run(op.controller.signal, (msg) => { op.progress = msg; });
      op.status = op.controller.signal.aborted ? "aborted" : "done";
    } catch (err) {
      op.status = op.controller.signal.aborted ? "aborted" : "failed";
      op.progress = err instanceof Error ? err.message : String(err);
    } finally {
      const ri = this.running.indexOf(op);
      if (ri >= 0) this.running.splice(ri, 1);
      this.pump(); // refill the running pool
    }
  }

  /** True once a submitted job has reached a terminal state. */
  isFinished(op: ActiveOperation): boolean {
    return op.status === "done" || op.status === "failed" || op.status === "aborted";
  }

  /** Wait until a job finishes (used by runTracked to mirror old await semantics). */
  async awaitCompletion(op: ActiveOperation): Promise<void> {
    while (!this.isFinished(op)) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  abort(id: number): ActiveOperation | undefined {
    const op = this.activeList().find((o) => o.id === id);
    if (!op) return undefined;
    op.controller.abort();
    op.status = "aborted";
    // If queued but not yet running, pump() will skip it (abort check) on shift.
    return op;
  }

  abortAll(): ActiveOperation[] {
    const aborted: ActiveOperation[] = [];
    for (const op of this.running) { op.controller.abort(); op.status = "aborted"; aborted.push(op); }
    for (const op of this.queue) { op.controller.abort(); op.status = "aborted"; aborted.push(op); }
    this.running = [];
    this.queue = [];
    return aborted;
  }

  activeList(): ActiveOperation[] {
    return [...this.running, ...this.queue];
  }

  /** Human-readable /status block. */
  statusLines(): string[] {
    const lines: string[] = [];
    const running = this.running;
    const queued = this.queue;
    if (running.length === 0 && queued.length === 0) {
      lines.push("🟢 *No active jobs.*");
      return lines;
    }
    if (running.length > 0) {
      lines.push(`⚙️ *Running: ${running.length} job(s)* (max ${this.maxConcurrent}):`);
      for (const op of running) {
        const elapsed = formatDuration(Date.now() - op.startedAt);
        lines.push(`  #${op.id} — ${op.description}`);
        lines.push(`    ⏱ ${elapsed} · ${op.progress}`);
      }
    }
    if (queued.length > 0) {
      lines.push(`⏳ *Queued: ${queued.length} job(s)*:`);
      for (const op of queued) {
        lines.push(`  #${op.id} — ${op.description} (waiting…)`);
      }
    }
    lines.push(`_Concurrency: ${this.maxConcurrent} job(s). /stop <id> to abort one._`);
    return lines;
  }
}
