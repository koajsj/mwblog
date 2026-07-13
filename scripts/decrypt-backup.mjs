import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const MAGIC = "MWBLOG_BACKUP_V2";
const TAG_BYTES = 16;

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
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

function backupKeyFromEnv() {
  const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (key) return key;
  if (process.env.ALLOW_LEGACY_BACKUP_PASSWORD === "1" && process.env.BACKUP_PASSWORD) {
    console.warn("Using the legacy password-derived backup key for recovery only.");
    return createHash("sha256").update(process.env.BACKUP_PASSWORD).digest();
  }
  return null;
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

async function main() {
  loadDotEnv();
  const input = process.argv[2];
  const output = process.argv[3] || "mwblog-backup.tar.gz";
  const key = backupKeyFromEnv();

  if (!input || !key) {
    console.error("Usage: BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.mjs <backup.tar.gz.enc> [output.tar.gz]");
    process.exit(1);
  }

  const source = resolve(input);
  const target = resolve(output);
  mkdirSync(dirname(target), { recursive: true });

  const { headerBytes, meta } = readHeader(source);
  const size = statSync(source).size;
  const tag = Buffer.alloc(TAG_BYTES);
  const fd = openSync(source, "r");
  readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(meta.iv, "base64url"));
  decipher.setAuthTag(tag);

  await pipeline(
    createReadStream(source, { start: headerBytes, end: size - TAG_BYTES - 1 }),
    decipher,
    createWriteStream(target, { mode: 0o600 }),
  );

  console.log(`Decrypted tarball written: ${target}`);
}

await main();
