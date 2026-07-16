/**
 * python-bridge.ts — Spawns the `scrapling_bridge.py` Python process and
 * communicates with it via JSON-RPC over stdin/stdout.
 *
 * The bridge process is a singleton — spawned once, reused across fetches.
 * It auto-restarts if Python exits unexpectedly.
 */

import { ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PythonBridgeRequest, PythonBridgeResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const BRIDGE_SCRIPT = join(__dirname, "..", "python", "scrapling_bridge.py");

/** Resolved when a response line arrives. */
interface PendingCall {
  resolve: (value: PythonBridgeResponse) => void;
  reject: (reason: Error) => void;
}

// ---------------------------------------------------------------------------
// Bridge singleton
// ---------------------------------------------------------------------------

let _child: ChildProcess | null = null;
let _pending: Map<number, PendingCall> = new Map();
let _reqId = 0;
let _startPromise: Promise<void> | null = null;

function _spawn(): Promise<void> {
  if (_startPromise) return _startPromise;

  _startPromise = new Promise<void>((resolve, reject) => {
    const child = spawn("python3", [BRIDGE_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    const rl = createInterface({ input: child.stdout! });

    rl.on("line", (line: string) => {
      try {
        const resp: PythonBridgeResponse = JSON.parse(line);
        // Responses are returned in order — pop the oldest pending call.
        const [id, pending] = _pending.entries().next().value as [
          number,
          PendingCall | undefined,
        ];
        if (pending) {
          _pending.delete(id);
          pending.resolve(resp);
        }
      } catch {
        // malformed line — ignore
      }
    });

    // Collect stderr for diagnostics
    let stderrBuf = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    child.on("error", (err) => {
      _child = null;
      _startPromise = null;
      reject(err);
    });

    child.on("exit", (code, signal) => {
      _child = null;
      _startPromise = null;
      // Reject all pending calls
      for (const [, pending] of _pending) {
        pending.reject(
          new Error(
            `Python bridge exited code=${code} signal=${signal} stderr=${stderrBuf.slice(-500)}`,
          ),
        );
      }
      _pending.clear();
    });

    // Wait for the first "ready" signal: the child's stdout opening means it started.
    child.stdout!.once("data", () => {
      _child = child;
      resolve();
    });
  });

  return _startPromise;
}

async function _ensureChild(): Promise<ChildProcess> {
  if (_child && !_child.killed && _child.exitCode === null) {
    return _child;
  }
  await _spawn();
  return _child!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a request to the Python bridge and wait for the response.
 * Auto-spawns the Python process on first call.
 */
export async function bridgeCall(
  req: PythonBridgeRequest,
): Promise<PythonBridgeResponse> {
  const child = await _ensureChild();
  const id = _reqId++;

  return new Promise<PythonBridgeResponse>((resolve, reject) => {
    _pending.set(id, { resolve, reject });

    const payload = JSON.stringify(req) + "\n";
    child.stdin!.write(payload, (err) => {
      if (err) {
        _pending.delete(id);
        reject(err);
      }
    });
  });
}

/** Check whether the Python bridge is alive and Scrapling is importable. */
export async function bridgeHealth(): Promise<boolean> {
  try {
    const resp = await bridgeCall({ action: "health", url: "" });
    return resp.success === true;
  } catch {
    return false;
  }
}

/** Tear down the Python child process. */
export function bridgeShutdown(): void {
  if (_child && !_child.killed) {
    _child.kill();
    _child = null;
  }
  _pending.clear();
  _startPromise = null;
}
