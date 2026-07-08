import { createDecipheriv, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  appendFileSync,
  copyFileSync,
} from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const MAGIC = "MWBLOG_BACKUP_V1";
const TAG_BYTES = 16;

const RESTORE_TABLES = [
  "blog_posts",
  "life_records",
  "activity_entries",
  "places",
  "photos",
  "todos",
  "todo_activity_entries",
  "comments",
];

const OWNER_FIELDS = new Map([
  ["blog_posts", "author_id"],
  ["life_records", "owner_id"],
  ["activity_entries", "owner_id"],
  ["places", "owner_id"],
  ["photos", "owner_id"],
  ["todos", "owner_id"],
  ["comments", "author_id"],
]);

function loadDotEnv(path = resolve(process.cwd(), ".env")) {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function appendEnvLine(name, value) {
  const envPath = resolve(process.cwd(), ".env");
  if (!value || process.env[name]) return;
  appendFileSync(envPath, `\n${name}=${value}\n`, { mode: 0o600 });
  process.env[name] = value;
  console.log(`Added ${name} from backup to .env`);
}

function decodeKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(value).digest();
}

function readHeader(path) {
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(4096);
  const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
  const newline = buffer.subarray(0, bytesRead).indexOf(10);
  if (newline <= 0) throw new Error("Invalid backup header");

  const line = buffer.subarray(0, newline).toString("utf8");
  if (!line.startsWith(`${MAGIC} `)) throw new Error("Unsupported backup format");
  return { headerBytes: newline + 1, meta: JSON.parse(line.slice(MAGIC.length + 1)) };
}

async function decryptBackup(input, output, key) {
  const { headerBytes, meta } = readHeader(input);
  const size = statSync(input).size;
  const tag = Buffer.alloc(TAG_BYTES);
  const fd = openSync(input, "r");
  readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(meta.iv, "base64url"));
  decipher.setAuthTag(tag);

  await pipeline(
    createReadStream(input, { start: headerBytes, end: size - TAG_BYTES - 1 }),
    decipher,
    createWriteStream(output, { mode: 0o600 }),
  );
}

function readJson(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function remapOwner(row, table, idMap) {
  const next = { ...row };
  const ownerField = OWNER_FIELDS.get(table);
  if (ownerField && next[ownerField]) {
    next[ownerField] = idMap.get(next[ownerField]) || next[ownerField];
  }
  return next;
}

async function upsertRows(supabase, table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).upsert(chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`${table}: restored ${rows.length} rows`);
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walkFiles(path));
    if (stat.isFile()) files.push(path);
  }
  return files;
}

async function ensureBucket(supabase, name, options) {
  const { data } = await supabase.storage.getBucket(name);
  if (data) {
    const { error } = await supabase.storage.updateBucket(name, options);
    if (error) throw new Error(`${name}: ${error.message}`);
    return;
  }
  const { error } = await supabase.storage.createBucket(name, options);
  if (error && !/already exists/i.test(error.message)) throw new Error(`${name}: ${error.message}`);
}

async function restoreStorage(supabase, root) {
  await ensureBucket(supabase, "photos", {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/octet-stream", "image/jpeg", "image/png", "image/webp", "image/gif"],
  });
  await ensureBucket(supabase, "blog-markdown", {
    public: false,
    fileSizeLimit: 1024 * 1024,
    allowedMimeTypes: ["text/markdown", "text/plain"],
  });

  for (const bucket of ["photos", "blog-markdown"]) {
    const bucketDir = join(root, "storage", bucket);
    const files = walkFiles(bucketDir);
    for (const file of files) {
      const storagePath = relative(bucketDir, file).split(sep).join("/");
      const contentType = bucket === "photos" ? "application/octet-stream" : "text/plain; charset=utf-8";
      const { error } = await supabase.storage.from(bucket).upload(storagePath, readFileSync(file), {
        contentType,
        upsert: true,
      });
      if (error) throw new Error(`${bucket}/${storagePath}: ${error.message}`);
    }
    console.log(`${bucket}: restored ${files.length} files`);
  }
}

async function restoreProfiles(supabase, root) {
  const sourceProfiles = readJson(join(root, "tables", "profiles.json"));
  const { data: targetProfiles, error } = await supabase.from("profiles").select("*");
  if (error) throw error;

  const targetByAuthor = new Map((targetProfiles || []).map((profile) => [profile.author_key, profile]));
  const idMap = new Map();

  for (const source of sourceProfiles) {
    const target = targetByAuthor.get(source.author_key);
    if (!target) continue;
    idMap.set(source.id, target.id);

    const patch = { ...source, id: target.id, email: target.email, author_key: target.author_key };
    const { error: updateError } = await supabase.from("profiles").upsert(patch, { onConflict: "id" });
    if (updateError) throw updateError;
  }

  console.log(`profiles: restored ${idMap.size} mapped profiles`);
  return idMap;
}

async function prepareBackupRoot(input, key) {
  const tempRoot = await mkdtemp(join(tmpdir(), "mwblog-restore-"));
  await chmod(tempRoot, 0o700);

  if (statSync(input).isDirectory()) {
    return { root: input, cleanup: () => rmSync(tempRoot, { recursive: true, force: true }) };
  }

  const tarPath = join(tempRoot, "backup.tar.gz");
  if (input.endsWith(".enc")) {
    if (!key) throw new Error("Missing BACKUP_ENCRYPTION_KEY or BACKUP_PASSWORD.");
    await decryptBackup(input, tarPath, key);
  } else {
    copyFileSync(input, tarPath);
  }

  const root = join(tempRoot, "unpacked");
  mkdirSync(root, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", tarPath, "-C", root], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error("Could not extract backup tarball.");
  return { root, cleanup: () => rmSync(tempRoot, { recursive: true, force: true }) };
}

async function main() {
  loadDotEnv();
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npm run restore -- /path/to/mwblog-backup.tar.gz.enc");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const backupKey = decodeKey(process.env.BACKUP_ENCRYPTION_KEY || process.env.BACKUP_PASSWORD || process.env.APP_ENCRYPTION_KEY);
  if (!url || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  if (process.env.SKIP_SETUP_USERS !== "1") {
    const setup = spawnSync("npm", ["run", "setup:users"], { stdio: "inherit", shell: process.platform === "win32" });
    if (setup.status !== 0) throw new Error("setup:users failed");
  }

  const prepared = await prepareBackupRoot(resolve(input), backupKey);
  try {
    const supabase = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const backupEnvPath = join(prepared.root, "private", "env.txt");
    if (existsSync(backupEnvPath)) {
      const backupEnv = readFileSync(backupEnvPath, "utf8");
      const backupAppKey = backupEnv.match(/^APP_ENCRYPTION_KEY=(.+)$/m)?.[1]?.trim();
      const backupBackupKey = backupEnv.match(/^BACKUP_ENCRYPTION_KEY=(.+)$/m)?.[1]?.trim();
      appendEnvLine("APP_ENCRYPTION_KEY", backupAppKey);
      appendEnvLine("BACKUP_ENCRYPTION_KEY", backupBackupKey);
      if (backupAppKey && backupAppKey !== process.env.APP_ENCRYPTION_KEY) {
        throw new Error("Current APP_ENCRYPTION_KEY differs from the backup. Use the backup key before restoring.");
      }
    }

    const idMap = await restoreProfiles(supabase, prepared.root);
    for (const table of RESTORE_TABLES) {
      const rows = readJson(join(prepared.root, "tables", `${table}.json`)).map((row) => remapOwner(row, table, idMap));
      await upsertRows(supabase, table, rows);
    }
    await restoreStorage(supabase, prepared.root);
    console.log("Restore complete.");
  } finally {
    prepared.cleanup();
  }
}

await main();
