import { createCipheriv, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "profiles",
  "private_space_keys",
  "blog_posts",
  "photos",
  "life_records",
  "activity_entries",
  "places",
  "comments",
  "todos",
  "todo_activity_entries",
];

const BUCKETS = ["photos", "blog-markdown"];
const MAGIC = "MWBLOG_BACKUP_V1";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return null;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return envPath;
}

function decodeKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return null;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeJoin(root, relativePath) {
  const target = resolve(root, relativePath);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
    throw new Error(`Unsafe storage path: ${relativePath}`);
  }
  return target;
}

async function exportTable(supabase, table, outDir) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  writeFileSync(join(outDir, `${table}.json`), JSON.stringify(rows, null, 2));
  return rows.length;
}

async function listBucketObjects(supabase, bucket, prefix = "") {
  const objects = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        objects.push(path);
      } else {
        objects.push(...(await listBucketObjects(supabase, bucket, path)));
      }
    }

    if (data.length < 1000) break;
    offset += 1000;
  }

  return objects;
}

async function exportBucket(supabase, bucket, outDir) {
  const bucketDir = join(outDir, bucket);
  mkdirSync(bucketDir, { recursive: true });

  const objects = await listBucketObjects(supabase, bucket);
  for (const objectPath of objects) {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath);
    if (error) throw new Error(`${bucket}/${objectPath}: ${error.message}`);
    const filePath = safeJoin(bucketDir, objectPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.from(await data.arrayBuffer()));
  }

  return objects.length;
}

class Prepend extends Transform {
  constructor(header) {
    super();
    this.header = Buffer.from(header);
    this.sent = false;
  }

  _transform(chunk, encoding, callback) {
    if (!this.sent) {
      this.push(this.header);
      this.sent = true;
    }
    this.push(chunk);
    callback();
  }

  _flush(callback) {
    if (!this.sent) this.push(this.header);
    callback();
  }
}

class AppendTag extends Transform {
  constructor(getTag) {
    super();
    this.getTag = getTag;
  }

  _transform(chunk, encoding, callback) {
    this.push(chunk);
    callback();
  }

  _flush(callback) {
    this.push(this.getTag());
    callback();
  }
}

async function encryptFile(inputPath, outputPath, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = `${MAGIC} ${JSON.stringify({ iv: iv.toString("base64url"), source: basename(inputPath) })}\n`;

  await pipeline(
    createReadStream(inputPath),
    cipher,
    new Prepend(header),
    new AppendTag(() => cipher.getAuthTag()),
    createWriteStream(outputPath, { mode: 0o600 }),
  );
}

async function main() {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const backupKey = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);

  if (!url || !serviceRoleKey || !backupKey) {
    console.error("Missing credentials or BACKUP_ENCRYPTION_KEY is not a 32-byte hex/base64 key.");
    process.exit(1);
  }

  const backupDir = resolve(process.env.BACKUP_DIR || "backups");
  mkdirSync(backupDir, { recursive: true });
  await chmod(backupDir, 0o700);

  const stamp = timestamp();
  const workDir = await mkdtemp(join(tmpdir(), `mwblog-backup-${stamp}-`));
  await chmod(workDir, 0o700);
  let tarPath = null;

  try {
    const tableDir = join(workDir, "tables");
    const storageDir = join(workDir, "storage");
    mkdirSync(tableDir, { recursive: true });
    mkdirSync(storageDir, { recursive: true });

    const supabase = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tableCounts = {};
    for (const table of TABLES) {
      tableCounts[table] = await exportTable(supabase, table, tableDir);
      console.log(`table ${table}: ${tableCounts[table]} rows`);
    }

    const storageCounts = {};
    for (const bucket of BUCKETS) {
      storageCounts[bucket] = await exportBucket(supabase, bucket, storageDir);
      console.log(`bucket ${bucket}: ${storageCounts[bucket]} files`);
    }

    writeFileSync(
      join(workDir, "manifest.json"),
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          tables: tableCounts,
          storage: storageCounts,
          includes_env: false,
        },
        null,
        2,
      ),
    );

    tarPath = `${workDir}.tar.gz`;
    const encPath = join(backupDir, `mwblog-${stamp}.tar.gz.enc`);
    const tar = spawnSync("tar", ["-czf", tarPath, "-C", workDir, "."], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error("tar command failed");

    await encryptFile(tarPath, encPath, backupKey);

    console.log(`Encrypted backup written: ${encPath}`);
  } finally {
    if (tarPath) rmSync(tarPath, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
