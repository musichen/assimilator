/**
 * System health snapshot for /status — CPU load, memory, disk, top processes.
 *
 * Pure Node (os module + /usr/bin/ps + vm_stat), no external agents/tools.
 * The bot already IS the watcher: every /status call shows live system state,
 * and jobs get their own section. This replaces the idea of a separate
 * background watchdog process — nothing extra hangs around.
 */

import * as os from "node:os";
import { execFile } from "node:child_process";

export interface SystemSnapshot {
  loadAvg: number[];          // 1, 5, 15 min
  cpuCount: number;
  cpuPercent: number;         // overall, sampled over ~1s
  memTotalGb: number;
  memUsedGb: number;
  memPercent: number;
  swapUsedGb: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskPercent: number;
  uptimeDays: number;
  topProcesses: { cpu: string; mem: string; cmd: string }[];
  services: { name: string; ok: boolean; cpu: string; memMb: string }[];
}

function execFileP(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : String(stdout));
    });
  });
}

/** Sample CPU twice with a short gap to get a real utilization percent. */
async function cpuPercent(): Promise<number> {
  const read = () => {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const c of cpus) {
      for (const t of Object.values(c.times)) total += Number(t);
      idle += Number(c.times.idle);
    }
    return { idle, total };
  };
  const a = read();
  await new Promise((r) => setTimeout(r, 900));
  const b = read();
  const dTotal = b.total - a.total;
  const dIdle = b.idle - a.idle;
  if (dTotal <= 0) return 0;
  return Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10;
}

/** Top processes by CPU via ps (macOS-compatible -axo). */
async function topProcesses(n: number): Promise<{ cpu: string; mem: string; cmd: string }[]> {
  const out = await execFileP("/bin/ps", ["-axo", "pcpu,pmem,comm", "-r"], 5000);
  return out.split("\n").slice(1, n + 1)
    .map((line) => {
      const m = line.trim().match(/^(\S+)\s+(\S+)\s+(.+)$/);
      return m ? { cpu: m[1]!, mem: m[2]!, cmd: m[3]!.slice(0, 60) } : null;
    })
    .filter((x): x is { cpu: string; mem: string; cmd: string } => x !== null);
}

/** Check key local services (HTTP endpoints we manage). */
async function services(): Promise<SystemSnapshot["services"]> {
  const checks: { name: string; url: string }[] = [
    { name: "hindsight :8888", url: "http://127.0.0.1:8888/health" },
    { name: "bgutil-pot :4416", url: "http://127.0.0.1:4416/ping" },
  ];
  const result: SystemSnapshot["services"] = [];
  for (const s of checks) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(4000) });
      result.push({ name: s.name, ok: res.ok, cpu: "", memMb: "" });
    } catch {
      result.push({ name: s.name, ok: false, cpu: "", memMb: "" });
    }
  }
  // Include the bot's own Hindsight dependency CPU/RAM via ps lookup
  const pgrep = await execFileP("/bin/ps", ["-axo", "pcpu,rss,command"], 5000);
  const lines = pgrep.split("\n").filter((l) => l.includes("hindsight-api --port 8888"));
  if (lines.length) {
    const parts = lines[0].trim().split(/\s+/);
    result[0] = { ...result[0]!, cpu: `${parts[0]}%`, memMb: `${Math.round(Number(parts[1]) / 1024)}` };
  }
  return result;
}

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const mem = os.totalmem();
  const freemem = os.freemem();
  const used = mem - freemem;
  const loadAvg = os.loadavg();

  // Disk: use statfs via df on the workspace dir (macOS)
  let disk = { total: 0, used: 0, pct: 0 };
  const dfOut = await execFileP("/bin/df", ["-k", "/Users/musichen"], 5000);
  const dfLine = dfOut.split("\n")[1];
  if (dfLine) {
    const parts = dfLine.trim().split(/\s+/);
    const totalKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    if (totalKb > 0) {
      disk = {
        total: totalKb / 1024 / 1024,
        used: usedKb / 1024 / 1024,
        pct: Math.round((usedKb / totalKb) * 1000) / 10,
      };
    }
  }

  // Swap (macOS: sysctl vm.swapusage)
  let swapUsed = 0;
  const vm = await execFileP("/usr/sbin/sysctl", ["vm.swapusage"], 5000);
  const swapMatch = vm.match(/used = (\d+)/);
  if (swapMatch) swapUsed = Number(swapMatch[1]) / 1024 / 1024 / 1024;

  return {
    loadAvg: loadAvg.map((x) => Math.round(x * 100) / 100),
    cpuCount: os.cpus().length,
    cpuPercent: await cpuPercent(),
    memTotalGb: Math.round((mem / 1024 ** 3) * 10) / 10,
    memUsedGb: Math.round((used / 1024 ** 3) * 10) / 10,
    memPercent: Math.round((used / mem) * 1000) / 10,
    swapUsedGb: Math.round(swapUsed * 100) / 100,
    diskTotalGb: Math.round(disk.total * 10) / 10,
    diskUsedGb: Math.round(disk.used * 10) / 10,
    diskPercent: disk.pct,
    uptimeDays: Math.round((os.uptime() / 86400) * 10) / 10,
    topProcesses: await topProcesses(5),
    services: await services(),
  };
}

export function formatSystemSnapshot(s: SystemSnapshot): string {
  const load = s.loadAvg.join(" / ");
  const memBar = bar(s.memPercent, 10);
  const diskBar = bar(s.diskPercent, 10);
  const lines = [
    "🖥️ *System*",
    `CPU: ${s.cpuPercent}% · load ${load} (${s.cpuCount} cores)`,
    `RAM: ${memBar} ${s.memUsedGb}/${s.memTotalGb} GB (${s.memPercent}%)` + (s.swapUsedGb > 0.05 ? ` · swap ${s.swapUsedGb} GB` : ""),
    `Disk: ${diskBar} ${s.diskUsedGb}/${s.diskTotalGb} GB (${s.diskPercent}%)`,
    `Uptime: ${s.uptimeDays}d`,
    "",
    "🔌 *Services*",
    ...s.services.map((svc) => `- ${svc.name}: ${svc.ok ? "✅" : "❌"}${svc.cpu ? ` (CPU ${svc.cpu}${svc.memMb ? `, ${svc.memMb} MB` : ""})` : ""}`),
    "",
    "⚡ *Top processes*",
    ...s.topProcesses.map((p) => `- ${p.cpu}% CPU · ${p.mem}% MEM · ${p.cmd}`),
  ];
  return lines.join("\n");
}

function bar(pct: number, len: number): string {
  const filled = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return "█".repeat(filled) + "░".repeat(len - filled);
}
