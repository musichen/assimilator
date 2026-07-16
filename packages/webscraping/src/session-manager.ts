/**
 * session-manager.ts — Persists cookie and header state keyed by domain.
 *
 * Sessions are serialised as JSON files under a configurable directory so
 * the fetcher chain can carry forward cookies across fetches, matching the
 * behaviour of Scrapling's own FetcherSession / DynamicSession but in a
 * tier-agnostic way (the Chrome tier reads this state too).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetcherTier, SessionState } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_STORE_DIR = join(
  process.env.HOME ?? "/tmp",
  ".assimilator",
  "sessions",
);

let _storeDir: string = DEFAULT_STORE_DIR;
let _ready = false;

async function _ensureDir(): Promise<void> {
  if (!_ready) {
    await mkdir(_storeDir, { recursive: true });
    _ready = true;
  }
}

function _domainToKey(domain: string): string {
  // Normalise: strip protocol, port, trailing slash, www prefix.
  let key = domain
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "")
    .replace(/\/+$/, "")
    .replace(/^www\./, "")
    .toLowerCase();

  // Replace chars unsafe for filenames.
  return key.replace(/[^a-z0-9.-]/g, "_");
}

function _filePath(domain: string): string {
  return join(_storeDir, `${_domainToKey(domain)}.json`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Override the directory where session files are stored.
 * Call once before any other session operations.
 */
export function setStoreDir(dir: string): void {
  _storeDir = dir;
  _ready = false;
}

/** Read persisted state for a domain. Returns `null` when no file exists. */
export async function loadSession(
  domain: string,
): Promise<SessionState | null> {
  await _ensureDir();
  try {
    const raw = await readFile(_filePath(domain), "utf-8");
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

/** Persist session state for a domain. */
export async function saveSession(state: SessionState): Promise<void> {
  await _ensureDir();
  const payload: SessionState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(_filePath(state.domain), JSON.stringify(payload, null, 2));
}

/**
 * Merge freshly captured cookies / headers into the persisted session for a
 * domain, then write back. If no session exists yet, one is created.
 */
export async function updateSession(
  domain: string,
  incoming: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    lastSuccessfulTier?: FetcherTier;
  },
): Promise<SessionState> {
  const existing = (await loadSession(domain)) ?? {
    domain,
    cookies: {},
    headers: {},
    updatedAt: new Date().toISOString(),
  };

  if (incoming.cookies) {
    existing.cookies = { ...existing.cookies, ...incoming.cookies };
  }
  if (incoming.headers) {
    existing.headers = { ...existing.headers, ...incoming.headers };
  }
  if (incoming.lastSuccessfulTier) {
    existing.lastSuccessfulTier = incoming.lastSuccessfulTier;
  }

  await saveSession(existing);
  return existing;
}

/** Delete a session file for the given domain (no-op if it doesn't exist). */
export async function deleteSession(domain: string): Promise<void> {
  await _ensureDir();
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(_filePath(domain));
  } catch {
    // file doesn't exist — that's fine
  }
}
