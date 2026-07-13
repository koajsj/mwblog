import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { backup, DatabaseSync } from "node:sqlite";

const MAGIC = "MWBLOG_BACKUP_V2";

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
  try {
    const key = Buffer.from(value, "base64");
    return key.length === 32 ? key : null;
  } catch { return null; }
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

class Prepend extends Transform {
  constructor(header) { super(); this.header = Buffer.from(header); this.sent = false; }
  _transform(chunk, _encoding, callback) {
    if (!this.sent) { this.push(this.header); this.sent = true; }
    this.push(chunk); callback();
  }
  _flush(callback) { if (!this.sent) this.push(this.header); callback(); }
}

class AppendTag extends Transform {
  constructor(getTag) { super(); this.getTag = getTag; }
  _transform(chunk, _encoding, callback) { this.push(chunk); callback(); }
  _flush(callback) { this.push(this.getTag()); callback(); }
}

async function encryptFile(input, output, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = `${MAGIC} ${JSON.stringify({ iv: iv.toString("base64url"), source: basename(input) })}\n`;
  await pipeline(
    createReadStream(input), cipher, new Prepend(header), new AppendTag(() => cipher.getAuthTag()),
    createWriteStream(output, { mode: 0o600 }),
  );
}

async function main() {
  loadDotEnv();
  const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY must be a 32-byte base64 or hex key.");

  const dataDir = resolve(process.env.APP_DATA_DIR || ".data");
  const databasePath = join(dataDir, "our-nest.sqlite");
  const backupDir = resolve(process.env.BACKUP_DIR || "backups");
  if (!existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workDir = await mkdtemp(join(tmpdir(), `mwblog-backup-${stamp}-`));
  const snapshotDir = join(workDir, "data");
  const snapshotDb = join(snapshotDir, "our-nest.sqlite");
  const tarPath = `${workDir}.tar.gz`;
  try {
    mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
    const source = new DatabaseSync(databasePath, { readOnly: true });
    let databaseSchemaVersion = 0;
    try {
      databaseSchemaVersion = Number(source.prepare("PRAGMA user_version").get()?.user_version || 0);
      await backup(source, snapshotDb);
    } finally { source.close(); }
    if (existsSync(join(dataDir, "storage"))) cpSync(join(dataDir, "storage"), join(snapshotDir, "storage"), { recursive: true });

    const files = walkFiles(snapshotDir).sort().map((path) => ({
      path: relative(workDir, path).replaceAll("\\", "/"),
      bytes: statSync(path).size,
      sha256: sha256(path),
    }));
    writeFileSync(join(workDir, "manifest.json"), JSON.stringify({
      version: 2,
      database_schema_version: databaseSchemaVersion,
      created_at: new Date().toISOString(),
      files,
    }, null, 2));

    const tar = spawnSync("tar", ["-czf", tarPath, "-C", workDir, "."], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error("Could not create backup archive.");
    const output = join(backupDir, `mwblog-${stamp}.tar.gz.enc`);
    await encryptFile(tarPath, output, key);
    console.log(`Encrypted backup written: ${output}`);
  } finally {
    rmSync(tarPath, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
