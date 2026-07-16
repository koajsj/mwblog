import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type BackupHealth = {
  status: "ok" | "failed" | "unknown";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  snapshotVerifiedAt: string | null;
  stale: boolean;
};

type StoredBackupStatus = {
  version?: unknown;
  status?: unknown;
  last_attempt_at?: unknown;
  last_success_at?: unknown;
  snapshot_verified_at?: unknown;
};

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function isoTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null;
}

export function backupStatusPath(dataDir = resolve(process.env.APP_DATA_DIR || ".data")) {
  return join(dataDir, "backup-status.json");
}

export function parseBackupHealth(value: unknown, now = Date.now()): BackupHealth {
  const unknown: BackupHealth = {
    status: "unknown",
    lastAttemptAt: null,
    lastSuccessAt: null,
    snapshotVerifiedAt: null,
    stale: false,
  };
  if (!value || typeof value !== "object") return unknown;

  const stored = value as StoredBackupStatus;
  if (stored.version !== 1 || (stored.status !== "ok" && stored.status !== "failed")) return unknown;

  const lastAttemptAt = isoTimestamp(stored.last_attempt_at);
  const lastSuccessAt = isoTimestamp(stored.last_success_at);
  const snapshotVerifiedAt = isoTimestamp(stored.snapshot_verified_at);
  if (stored.status === "ok" && (!lastSuccessAt || !snapshotVerifiedAt)) return unknown;
  const lastSuccessMs = lastSuccessAt ? Date.parse(lastSuccessAt) : NaN;

  return {
    status: stored.status,
    lastAttemptAt,
    lastSuccessAt,
    snapshotVerifiedAt,
    stale: Number.isFinite(lastSuccessMs) && now - lastSuccessMs > STALE_AFTER_MS,
  };
}

export async function readBackupHealth(dataDir?: string, now = Date.now()) {
  try {
    const raw = await readFile(backupStatusPath(dataDir), "utf8");
    if (raw.length > 4096) return parseBackupHealth(null, now);
    return parseBackupHealth(JSON.parse(raw), now);
  } catch {
    return parseBackupHealth(null, now);
  }
}
