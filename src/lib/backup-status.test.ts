import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseBackupHealth, readBackupHealth } from "./backup-status.ts";

test("backup health accepts only the minimal status format", () => {
  const health = parseBackupHealth({
    version: 1,
    status: "ok",
    last_attempt_at: "2026-07-16T01:00:00.000Z",
    last_success_at: "2026-07-16T01:00:00.000Z",
    snapshot_verified_at: "2026-07-16T01:00:00.000Z",
    ignored_secret: "must not be returned",
  }, Date.parse("2026-07-16T12:00:00.000Z"));

  assert.deepEqual(health, {
    status: "ok",
    lastAttemptAt: "2026-07-16T01:00:00.000Z",
    lastSuccessAt: "2026-07-16T01:00:00.000Z",
    snapshotVerifiedAt: "2026-07-16T01:00:00.000Z",
    stale: false,
  });
});

test("backup health reports stale and malformed status safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "mwblog-backup-status-"));
  await writeFile(join(root, "backup-status.json"), JSON.stringify({
    version: 1,
    status: "failed",
    last_attempt_at: "2026-07-16T02:00:00.000Z",
    last_success_at: "2026-07-14T00:00:00.000Z",
    snapshot_verified_at: "not-a-date",
  }));

  const health = await readBackupHealth(root, Date.parse("2026-07-16T12:00:00.000Z"));
  assert.equal(health.status, "failed");
  assert.equal(health.stale, true);
  assert.equal(health.snapshotVerifiedAt, null);

  await writeFile(join(root, "backup-status.json"), "not json");
  assert.equal((await readBackupHealth(root)).status, "unknown");
});
