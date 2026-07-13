import { createDecipheriv, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, cpSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";

const MAGIC = "MWBLOG_BACKUP_V2";
const TAG_BYTES = 16;

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function decodeKey(raw) {
  const value = String(raw || "").trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try { const key = Buffer.from(value, "base64"); return key.length === 32 ? key : null; } catch { return null; }
}

function readHeader(path) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    if (newline <= 0) throw new Error("Invalid backup header.");
    const line = buffer.subarray(0, newline).toString("utf8");
    if (!line.startsWith(`${MAGIC} `)) throw new Error("Unsupported backup version.");
    return { headerBytes: newline + 1, meta: JSON.parse(line.slice(MAGIC.length + 1)) };
  } finally { closeSync(fd); }
}

async function decrypt(input, output, key) {
  const { headerBytes, meta } = readHeader(input);
  const size = statSync(input).size;
  const tag = Buffer.alloc(TAG_BYTES);
  const fd = openSync(input, "r");
  try { readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES); } finally { closeSync(fd); }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(meta.iv, "base64url"));
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(input, { start: headerBytes, end: size - TAG_BYTES - 1 }),
    decipher,
    createWriteStream(output, { mode: 0o600 }),
  );
}

function safeFile(root, relativePath) {
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Unsafe path in backup manifest.");
  return target;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function validateArchiveListing(path) {
  const listed = spawnSync("tar", ["-tzf", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error("Could not inspect backup archive.");
  for (const raw of listed.stdout.split(/\r?\n/).filter(Boolean)) {
    const entry = raw.replace(/^\.\//, "").replace(/\/$/, "");
    if (!entry || entry === ".") continue;
    if (entry.includes("\\") || entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error("Unsafe path in backup archive.");
    }
    if (entry !== "manifest.json" && entry !== "data" && !entry.startsWith("data/")) {
      throw new Error("Unexpected file in backup archive.");
    }
  }
}

function walkExtracted(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error("Backup contains an unsupported file type.");
    }
    if (info.isDirectory()) files.push(...walkExtracted(path));
    else files.push(path);
  }
  return files;
}

function validateBackup(root) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (manifest.version !== 2 || manifest.database_schema_version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("Unsupported backup manifest or database schema.");
  }
  const expectedFiles = new Set();
  for (const item of manifest.files) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[0-9a-f]{64}$/.test(String(item.sha256 || ""))) {
      throw new Error("Backup manifest contains invalid file metadata.");
    }
    const path = safeFile(root, String(item.path || ""));
    const relativePath = String(item.path || "").replaceAll("\\", "/");
    if (!relativePath.startsWith("data/") || expectedFiles.has(path)) throw new Error("Backup manifest contains an unsafe or duplicate path.");
    expectedFiles.add(path);
    if (!existsSync(path) || statSync(path).size !== item.bytes || sha256(path) !== item.sha256) {
      throw new Error(`Backup integrity check failed: ${item.path}`);
    }
  }
  const actualFiles = walkExtracted(join(root, "data"));
  if (actualFiles.length !== expectedFiles.size || actualFiles.some((path) => !expectedFiles.has(path))) {
    throw new Error("Backup archive contains files not covered by the integrity manifest.");
  }
  const dbPath = join(root, "data", "our-nest.sqlite");
  const database = new DatabaseSync(dbPath);
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") throw new Error("SQLite integrity check failed.");
    const profiles = database.prepare("SELECT account, author_key FROM profiles ORDER BY author_key").all();
    const identities = new Set(profiles.map((row) => `${row.account}|${row.author_key}`));
    if (!identities.has("kikou|white") || !identities.has("scoinmic|brown")) {
      throw new Error("Fixed account mappings are missing from the backup.");
    }
    database.exec("DELETE FROM sessions");
  } finally { database.close(); }
}

async function main() {
  loadDotEnv();
  const input = process.argv[2] ? resolve(process.argv[2]) : "";
  const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (!input || !existsSync(input) || !key) throw new Error("Usage: npm run restore -- /path/to/backup.tar.gz.enc");

  const dataDir = resolve(process.env.APP_DATA_DIR || ".data");
  const workDir = await mkdtemp(join(tmpdir(), "mwblog-restore-"));
  await chmod(workDir, 0o700);
  const tarPath = join(workDir, "backup.tar.gz");
  const unpacked = join(workDir, "unpacked");
  const staged = `${dataDir}.restore-${process.pid}`;
  const previous = `${dataDir}.before-restore-${process.pid}`;
  try {
    await decrypt(input, tarPath, key);
    validateArchiveListing(tarPath);
    mkdirSync(unpacked, { recursive: true });
    const tar = spawnSync("tar", ["-xzf", tarPath, "--no-same-owner", "--no-same-permissions", "-C", unpacked], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error("Could not extract backup.");
    validateBackup(unpacked);

    rmSync(staged, { recursive: true, force: true });
    cpSync(join(unpacked, "data"), staged, { recursive: true });
    mkdirSync(dirname(dataDir), { recursive: true });
    if (existsSync(dataDir)) renameSync(dataDir, previous);
    try {
      renameSync(staged, dataDir);
      rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
      if (existsSync(previous)) renameSync(previous, dataDir);
      throw error;
    }
    console.log("Restore complete. Existing sessions were cleared.");
  } finally {
    rmSync(staged, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
