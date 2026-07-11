import { createClient } from "@supabase/supabase-js";
import { createDecipheriv, createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEXT_PREFIX = "enc:wc2:";
const PREVIOUS_TEXT_PREFIX = "enc:wc1:";
const LEGACY_TEXT_PREFIX = "enc:v1:";
const FILE_PREFIX = "MWBLOG-WC2 ";
const PREVIOUS_FILE_PREFIX = "MWBLOG-WC1 ";
const LEGACY_FILE_PREFIX = "MWBLOG_FILE_V1 ";
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
const newPassphrase = process.env.SPACE_NEW_PASSPHRASE || "";
const newRecoveryCode = process.env.SPACE_NEW_RECOVERY_CODE || recoveryCode;

if (appKeyRaw && process.env.ALLOW_LEGACY_SERVER_DECRYPTION !== "1") {
  console.error("APP_ENCRYPTION_KEY enables legacy server-side decryption.");
  console.error("Set ALLOW_LEGACY_SERVER_DECRYPTION=1 only for an intentional one-off legacy migration.");
  process.exit(1);
}

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

function bundleIterations(bundle) {
  const iterations = Number(bundle?.kdf?.iterations);
  if (!Number.isInteger(iterations) || iterations < 200000 || iterations > 1000000) {
    throw new Error("Invalid private-space PBKDF2 iteration count.");
  }
  return iterations;
}

async function deriveWrappingKey(secret, salt, iterations, usages = ["decrypt"]) {
  const baseKey = await subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function wrapSpaceKey(rawKey, secret, iterations) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(secret, salt, iterations, ["encrypt"]);
  const data = await subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, rawKey);
  return { salt: b64urlEncode(salt), iv: b64urlEncode(iv), data: b64urlEncode(new Uint8Array(data)) };
}

async function unwrapSpaceKey(bundle) {
  const envelope = recoveryCode ? bundle.recovery : bundle.passphrase;
  const secret = recoveryCode || passphrase;
  const wrappingKey = await deriveWrappingKey(secret, b64urlDecode(envelope.salt), bundleIterations(bundle));
  const rawKey = await subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(envelope.iv) },
    wrappingKey,
    b64urlDecode(envelope.data),
  );
  return Buffer.from(rawKey);
}

async function importSpaceKey(rawKey) {
  return subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(context) {
  return encoder.encode(`mwblog:wc2:${context}`);
}

async function decryptPreviousText(value, key) {
  const payload = JSON.parse(decoder.decode(b64urlDecode(String(value).slice(PREVIOUS_TEXT_PREFIX.length))));
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(payload.iv) },
    key,
    b64urlDecode(payload.data),
  );
  return decoder.decode(plain);
}

async function encryptText(value, key, context) {
  if (!value) return "";
  if (String(value).startsWith(TEXT_PREFIX)) return String(value);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(context) },
    key,
    encoder.encode(String(value)),
  );
  return `${TEXT_PREFIX}${b64urlEncode(encoder.encode(JSON.stringify({
    iv: b64urlEncode(iv),
    data: b64urlEncode(new Uint8Array(ciphertext)),
    context,
  })))}`;
}

async function encryptFile(buffer, mimeType, key) {
  if (buffer.subarray(0, FILE_PREFIX.length).equals(Buffer.from(FILE_PREFIX, "utf8"))) return buffer;
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData("photo.file") },
    key,
    buffer,
  );
  const header = Buffer.from(`${FILE_PREFIX}${JSON.stringify({
    iv: b64urlEncode(iv),
    tag: "packed",
    mimeType: mimeType || "application/octet-stream",
    context: "photo.file",
  })}\n`, "utf8");
  return Buffer.concat([header, Buffer.from(ciphertext)]);
}

async function migrateTable(table, fields, key, legacyKey) {
  const fieldNames = Object.keys(fields);
  const { data, error } = await supabase.from(table).select(["id", ...fieldNames].join(","));
  if (error) throw error;
  let changed = 0;
  for (const row of data || []) {
    const patch = {};
    for (const field of fieldNames) {
      const current = row[field];
      if (!current || String(current).startsWith(TEXT_PREFIX)) continue;
      const plain = String(current).startsWith(PREVIOUS_TEXT_PREFIX)
        ? await decryptPreviousText(current, key)
        : String(current).startsWith(LEGACY_TEXT_PREFIX)
          ? decryptLegacyText(current, legacyKey)
          : String(current);
      patch[field] = await encryptText(plain, key, fields[field]);
    }
    if (!Object.keys(patch).length) continue;
    const { error: updateError } = await supabase.from(table).update(patch).eq("id", row.id);
    if (updateError) throw updateError;
    changed += 1;
  }
  console.log(`${table}: migrated ${changed} rows`);
}

async function migrateBlogTags(key) {
  const { data, error } = await supabase.from("blog_posts").select("id,tags");
  if (error) throw error;
  let changed = 0;
  for (const row of data || []) {
    const tags = Array.isArray(row.tags) ? row.tags : [];
    if (!tags.some((tag) => tag && !String(tag).startsWith(TEXT_PREFIX))) continue;
    const encrypted = [];
    for (const tag of tags) {
      const plain = String(tag).startsWith(PREVIOUS_TEXT_PREFIX) ? await decryptPreviousText(tag, key) : String(tag);
      encrypted.push(await encryptText(plain, key, "blog.tag"));
    }
    const { error: updateError } = await supabase.from("blog_posts").update({ tags: encrypted }).eq("id", row.id);
    if (updateError) throw updateError;
    changed += 1;
  }
  console.log(`blog_posts tags: migrated ${changed} rows`);
}

async function migrateBlogStorage(key, legacyKey) {
  const { data, error } = await supabase.from("blog_posts").select("id,storage_path,content_markdown");
  if (error) throw error;
  let changed = 0;
  for (const post of data || []) {
    if (!post.storage_path) continue;
    const value = String(post.content_markdown || "");
    const plain = value.startsWith(PREVIOUS_TEXT_PREFIX)
      ? await decryptPreviousText(value, key)
      : value.startsWith(LEGACY_TEXT_PREFIX)
        ? decryptLegacyText(value, legacyKey)
        : value;
    const encrypted = await encryptText(plain, key, "blog.content");
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
    let plain;
    if (original.subarray(0, PREVIOUS_FILE_PREFIX.length).equals(Buffer.from(PREVIOUS_FILE_PREFIX, "utf8"))) {
      const newline = original.indexOf(10);
      const header = JSON.parse(original.subarray(PREVIOUS_FILE_PREFIX.length, newline).toString("utf8"));
      const decrypted = await subtle.decrypt(
        { name: "AES-GCM", iv: b64urlDecode(header.iv) },
        key,
        original.subarray(newline + 1),
      );
      plain = { bytes: Buffer.from(decrypted), mimeType: String(header.mimeType || photo.mime_type || "application/octet-stream") };
    } else {
      plain = original.subarray(0, LEGACY_FILE_PREFIX.length).equals(Buffer.from(LEGACY_FILE_PREFIX, "utf8"))
        ? decryptLegacyFile(original, legacyKey)
        : { bytes: original, mimeType: String(photo.mime_type || file.type || "application/octet-stream") };
    }
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

async function verifyEncryptedText(value, key, context) {
  if (!String(value || "").startsWith(TEXT_PREFIX)) return false;
  try {
    const payload = JSON.parse(decoder.decode(b64urlDecode(String(value).slice(TEXT_PREFIX.length))));
    if (payload.context !== context) return false;
    await subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(payload.iv), additionalData: additionalData(context) },
      key,
      b64urlDecode(payload.data),
    );
    return true;
  } catch {
    return false;
  }
}

async function verifyTable(table, fields, key) {
  const fieldNames = Object.keys(fields);
  const { data, error } = await supabase.from(table).select(["id", ...fieldNames].join(","));
  if (error) throw error;
  for (const row of data || []) {
    for (const field of fieldNames) {
      const value = row[field];
      if (value === null || value === "") continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (!(await verifyEncryptedText(item, key, fields[field]))) {
          throw new Error(`${table}.${field} still contains invalid or legacy data (row ${row.id}).`);
        }
      }
    }
  }
}

async function verifyStorage(key) {
  const { data: posts, error: postError } = await supabase.from("blog_posts").select("id,storage_path");
  if (postError) throw postError;
  for (const post of posts || []) {
    if (!post.storage_path) continue;
    const { data, error } = await supabase.storage.from("blog-markdown").download(post.storage_path);
    if (error || !data) throw error || new Error(`Missing blog file ${post.storage_path}`);
    const value = await data.text();
    if (!(await verifyEncryptedText(value, key, "blog.content"))) {
      throw new Error(`Blog storage still contains invalid or legacy data (row ${post.id}).`);
    }
  }

  const { data: photos, error: photoError } = await supabase.from("photos").select("id,storage_path");
  if (photoError) throw photoError;
  for (const photo of photos || []) {
    if (!photo.storage_path) continue;
    const { data, error } = await supabase.storage.from("photos").download(photo.storage_path);
    if (error || !data) throw error || new Error(`Missing photo file ${photo.storage_path}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (!bytes.subarray(0, FILE_PREFIX.length).equals(Buffer.from(FILE_PREFIX, "utf8"))) {
      throw new Error(`Photo storage still contains plaintext or legacy data (row ${photo.id}).`);
    }
    const newline = bytes.indexOf(10);
    const header = JSON.parse(bytes.subarray(FILE_PREFIX.length, newline).toString("utf8"));
    if (header.context !== "photo.file") throw new Error(`Photo context is invalid (row ${photo.id}).`);
    await subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(header.iv), additionalData: additionalData("photo.file") },
      key,
      bytes.subarray(newline + 1),
    );
  }
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

await migrateTable("blog_posts", { title: "blog.title", excerpt: "blog.excerpt", content_markdown: "blog.content" }, clientKey, legacyKey);
await migrateBlogTags(clientKey);
await migrateTable("life_records", { body: "record.body" }, clientKey, legacyKey);
await migrateTable("comments", { body: "comment.body" }, clientKey, legacyKey);
await migrateTable("todos", { title: "todo.title" }, clientKey, legacyKey);
await migrateTable("photos", { title: "photo.title", caption: "photo.caption" }, clientKey, legacyKey);
await migrateTable("places", { name: "place.name", note: "place.note" }, clientKey, legacyKey);
await migrateTable("profiles", { weather_text: "profile.weather", mood_text: "profile.mood", doing_text: "profile.doing" }, clientKey, legacyKey);
await migrateTable("activity_entries", { body: "activity.body" }, clientKey, legacyKey);
await migrateBlogStorage(clientKey, legacyKey);
await migratePhotos(clientKey, legacyKey);

await verifyTable("blog_posts", { title: "blog.title", excerpt: "blog.excerpt", content_markdown: "blog.content", tags: "blog.tag" }, clientKey);
await verifyTable("life_records", { body: "record.body" }, clientKey);
await verifyTable("comments", { body: "comment.body" }, clientKey);
await verifyTable("todos", { title: "todo.title" }, clientKey);
await verifyTable("photos", { title: "photo.title", caption: "photo.caption" }, clientKey);
await verifyTable("places", { name: "place.name", note: "place.note" }, clientKey);
await verifyTable("profiles", { weather_text: "profile.weather", mood_text: "profile.mood", doing_text: "profile.doing" }, clientKey);
await verifyTable("activity_entries", { body: "activity.body" }, clientKey);
await verifyStorage(clientKey);

let finalBundle = bundleRow.bundle;
if (bundleIterations(finalBundle) < 600000) {
  if (newPassphrase.length < 14 || newRecoveryCode.length < 20) {
    throw new Error("Set SPACE_NEW_PASSPHRASE (14+ characters) and a valid SPACE_RECOVERY_CODE or SPACE_NEW_RECOVERY_CODE to upgrade the legacy key bundle.");
  }
  const iterations = 600000;
  finalBundle = {
    ...finalBundle,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations },
    passphrase: await wrapSpaceKey(rawSpaceKey, newPassphrase, iterations),
    recovery: await wrapSpaceKey(rawSpaceKey, newRecoveryCode, iterations),
  };
  const { error: bundleUpdateError } = await supabase
    .from("private_space_keys")
    .update({ bundle: finalBundle, updated_at: new Date().toISOString() })
    .eq("space_id", PRIVATE_SPACE_ID);
  if (bundleUpdateError) throw bundleUpdateError;
}

const { error: stateError } = await supabase
  .from("private_security_state")
  .upsert({ space_id: PRIVATE_SPACE_ID, version: 23, verified_at: new Date().toISOString() });
if (stateError) throw stateError;

console.log("Client-side encryption migration and verification complete.");
