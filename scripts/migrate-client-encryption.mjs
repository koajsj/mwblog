import { createClient } from "@supabase/supabase-js";
import { createDecipheriv, createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEXT_PREFIX = "enc:wc1:";
const LEGACY_TEXT_PREFIX = "enc:v1:";
const FILE_PREFIX = "MWBLOG-WC1 ";
const LEGACY_FILE_PREFIX = "MWBLOG_FILE_V1 ";
const PBKDF2_ITERATIONS = 310000;
const PRIVATE_SPACE_ID = "private-couple-space";

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

loadDotEnv();

const supabaseUrl = process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const appKeyRaw = process.env.APP_ENCRYPTION_KEY || "";
const passphrase = process.env.SPACE_PASSPHRASE || "";
const recoveryCode = process.env.SPACE_RECOVERY_CODE || "";

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

if (!passphrase && !recoveryCode) {
  console.error("Set SPACE_PASSPHRASE or SPACE_RECOVERY_CODE to unwrap the private-space key bundle.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function b64urlDecode(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function decodeLegacyKey(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(value).digest();
}

function decryptLegacyText(value, key) {
  if (!value) return "";
  if (!String(value).startsWith(LEGACY_TEXT_PREFIX)) return String(value);
  if (!key) throw new Error("Missing APP_ENCRYPTION_KEY for legacy text migration.");
  const [ivRaw, tagRaw, dataRaw] = String(value).slice(LEGACY_TEXT_PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function decryptLegacyFile(buffer, key) {
  if (!buffer.subarray(0, LEGACY_FILE_PREFIX.length).equals(Buffer.from(LEGACY_FILE_PREFIX, "utf8"))) {
    return { bytes: buffer, mimeType: "application/octet-stream" };
  }
  if (!key) throw new Error("Missing APP_ENCRYPTION_KEY for legacy photo migration.");
  const newline = buffer.indexOf(10);
  const header = JSON.parse(buffer.subarray(LEGACY_FILE_PREFIX.length, newline).toString("utf8"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(header.tag, "base64url"));
  return {
    bytes: Buffer.concat([decipher.update(buffer.subarray(newline + 1)), decipher.final()]),
    mimeType: String(header.mimeType || "application/octet-stream"),
  };
}

async function deriveWrappingKey(secret, salt) {
  const baseKey = await subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function unwrapSpaceKey(bundle) {
  const envelope = recoveryCode ? bundle.recovery : bundle.passphrase;
  const secret = recoveryCode || passphrase;
  const wrappingKey = await deriveWrappingKey(secret, b64urlDecode(envelope.salt));
  const rawKey = await subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(envelope.iv) },
    wrappingKey,
    b64urlDecode(envelope.data),
  );
  return Buffer.from(rawKey);
}

async function importSpaceKey(rawKey) {
  return subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function encryptText(value, key) {
  if (!value) return "";
  if (String(value).startsWith(TEXT_PREFIX)) return String(value);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(String(value)));
  return `${TEXT_PREFIX}${b64urlEncode(encoder.encode(JSON.stringify({
    iv: b64urlEncode(iv),
    data: b64urlEncode(new Uint8Array(ciphertext)),
  })))}`;
}

async function encryptFile(buffer, mimeType, key) {
  if (buffer.subarray(0, FILE_PREFIX.length).equals(Buffer.from(FILE_PREFIX, "utf8"))) return buffer;
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, buffer);
  const header = Buffer.from(`${FILE_PREFIX}${JSON.stringify({
    iv: b64urlEncode(iv),
    tag: "packed",
    mimeType: mimeType || "application/octet-stream",
  })}\n`, "utf8");
  return Buffer.concat([header, Buffer.from(ciphertext)]);
}

async function migrateTable(table, fields, key, legacyKey) {
  const { data, error } = await supabase.from(table).select(["id", ...fields].join(","));
  if (error) throw error;
  let changed = 0;
  for (const row of data || []) {
    const patch = {};
    for (const field of fields) {
      const current = row[field];
      if (!current || String(current).startsWith(TEXT_PREFIX)) continue;
      const plain = String(current).startsWith(LEGACY_TEXT_PREFIX) ? decryptLegacyText(current, legacyKey) : String(current);
      patch[field] = await encryptText(plain, key);
    }
    if (!Object.keys(patch).length) continue;
    const { error: updateError } = await supabase.from(table).update(patch).eq("id", row.id);
    if (updateError) throw updateError;
    changed += 1;
  }
  console.log(`${table}: migrated ${changed} rows`);
}

async function migrateBlogStorage(key, legacyKey) {
  const { data, error } = await supabase.from("blog_posts").select("id,storage_path,content_markdown");
  if (error) throw error;
  let changed = 0;
  for (const post of data || []) {
    if (!post.storage_path) continue;
    const plain = String(post.content_markdown || "").startsWith(LEGACY_TEXT_PREFIX)
      ? decryptLegacyText(post.content_markdown, legacyKey)
      : String(post.content_markdown || "");
    const encrypted = await encryptText(plain, key);
    const { error: uploadError } = await supabase.storage.from("blog-markdown").upload(post.storage_path, new Blob([encrypted]), {
      contentType: "text/plain; charset=utf-8",
      upsert: true,
    });
    if (uploadError) throw uploadError;
    changed += 1;
  }
  console.log(`blog-markdown storage: migrated ${changed} files`);
}

async function migratePhotos(key, legacyKey) {
  const { data, error } = await supabase.from("photos").select("id,storage_path,mime_type");
  if (error) throw error;
  let changed = 0;
  for (const photo of data || []) {
    if (!photo.storage_path) continue;
    const { data: file, error: downloadError } = await supabase.storage.from("photos").download(photo.storage_path);
    if (downloadError || !file) throw downloadError || new Error(`Missing photo file ${photo.storage_path}`);
    const original = Buffer.from(await file.arrayBuffer());
    if (original.subarray(0, FILE_PREFIX.length).equals(Buffer.from(FILE_PREFIX, "utf8"))) continue;
    const plain = original.subarray(0, LEGACY_FILE_PREFIX.length).equals(Buffer.from(LEGACY_FILE_PREFIX, "utf8"))
      ? decryptLegacyFile(original, legacyKey)
      : { bytes: original, mimeType: String(photo.mime_type || file.type || "application/octet-stream") };
    const encrypted = await encryptFile(plain.bytes, plain.mimeType, key);
    const { error: uploadError } = await supabase.storage.from("photos").upload(photo.storage_path, encrypted, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (uploadError) throw uploadError;
    changed += 1;
  }
  console.log(`photos storage: migrated ${changed} files`);
}

const { data: bundleRow, error: bundleError } = await supabase
  .from("private_space_keys")
  .select("bundle")
  .eq("space_id", PRIVATE_SPACE_ID)
  .maybeSingle();

if (bundleError) {
  console.error(bundleError.message);
  process.exit(1);
}
if (!bundleRow?.bundle) {
  console.error("No private_space_keys bundle found. Unlock the site in a browser once before running migration.");
  process.exit(1);
}

const legacyKey = decodeLegacyKey(appKeyRaw);
const rawSpaceKey = await unwrapSpaceKey(bundleRow.bundle);
const clientKey = await importSpaceKey(rawSpaceKey);

await migrateTable("blog_posts", ["title", "excerpt", "content_markdown"], clientKey, legacyKey);
await migrateTable("life_records", ["body"], clientKey, legacyKey);
await migrateTable("comments", ["body"], clientKey, legacyKey);
await migrateTable("todos", ["title"], clientKey, legacyKey);
await migrateTable("photos", ["title", "caption"], clientKey, legacyKey);
await migrateTable("places", ["name", "note"], clientKey, legacyKey);
await migrateTable("profiles", ["weather_text", "mood_text", "doing_text"], clientKey, legacyKey);
await migrateTable("activity_entries", ["body"], clientKey, legacyKey);
await migrateBlogStorage(clientKey, legacyKey);
await migratePhotos(clientKey, legacyKey);

console.log("Client-side encryption migration complete.");
