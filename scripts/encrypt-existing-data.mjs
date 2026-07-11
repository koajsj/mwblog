import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PREFIX = "enc:v1:";
const FILE_HEADER_PREFIX = "MWBLOG_FILE_V1 ";

const tableFields = [
  ["profiles", ["weather_text", "weather_label", "mood_text", "doing_text"]],
  ["blog_posts", ["title", "excerpt", "content_markdown"]],
  ["photos", ["title", "caption"]],
  ["life_records", ["body"]],
  ["activity_entries", ["body"]],
  ["places", ["name", "note"]],
  ["comments", ["body"]],
  ["todos", ["title"]],
];

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
  return createHash("sha256").update(value).digest();
}

function encrypt(value, key) {
  if (!value || typeof value !== "string" || value.startsWith(PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function fileIsEncrypted(buffer) {
  return buffer.subarray(0, FILE_HEADER_PREFIX.length).toString("utf8") === FILE_HEADER_PREFIX;
}

function encryptFileBytes(buffer, key, mimeType) {
  if (fileIsEncrypted(buffer)) return buffer;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const header = Buffer.from(`${FILE_HEADER_PREFIX}${JSON.stringify({
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    mimeType: mimeType || "application/octet-stream",
  })}\n`, "utf8");
  return Buffer.concat([header, ciphertext]);
}

async function selectAll(supabase, table, columns, build = (query) => query) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const query = build(supabase.from(table).select(columns)).range(from, from + pageSize - 1);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function encryptTable(supabase, table, fields, key) {
  const data = await selectAll(supabase, table, ["id", ...fields].join(","));

  let changed = 0;
  for (const row of data || []) {
    const patch = {};
    for (const field of fields) {
      const next = encrypt(row[field], key);
      if (next !== row[field]) patch[field] = next;
    }
    if (!Object.keys(patch).length) continue;
    const { error: updateError } = await supabase.from(table).update(patch).eq("id", row.id);
    if (updateError) throw updateError;
    changed += 1;
  }
  console.log(`${table}: encrypted ${changed} rows`);
}

async function encryptMarkdownBackups(supabase, key) {
  const posts = await selectAll(supabase, "blog_posts", "storage_path,content_markdown", (query) =>
    query.not("storage_path", "is", null),
  );

  let changed = 0;
  for (const post of posts || []) {
    if (!post.storage_path || !post.content_markdown?.startsWith(PREFIX)) continue;
    const { data: file } = await supabase.storage.from("blog-markdown").download(post.storage_path);
    const text = file ? await file.text() : "";
    if (!text || text.startsWith(PREFIX)) continue;
    const { error: uploadError } = await supabase.storage
      .from("blog-markdown")
      .upload(post.storage_path, new Blob([encrypt(text, key)]), {
        contentType: "text/plain; charset=utf-8",
        upsert: true,
      });
    if (uploadError) throw uploadError;
    changed += 1;
  }
  console.log(`blog-markdown: encrypted ${changed} backups`);
}

async function encryptPhotoStorage(supabase, key) {
  const photos = await selectAll(supabase, "photos", "storage_path,mime_type", (query) =>
    query.not("storage_path", "is", null),
  );

  let changed = 0;
  for (const photo of photos || []) {
    if (!photo.storage_path) continue;
    const { data: file, error: downloadError } = await supabase.storage.from("photos").download(photo.storage_path);
    if (downloadError) throw downloadError;
    const original = Buffer.from(await file.arrayBuffer());
    if (fileIsEncrypted(original)) continue;
    const encrypted = encryptFileBytes(original, key, photo.mime_type || file.type);
    const { error: uploadError } = await supabase.storage.from("photos").upload(photo.storage_path, encrypted, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (uploadError) throw uploadError;
    changed += 1;
  }
  console.log(`photos storage: encrypted ${changed} files`);
}

loadDotEnv();

if (process.env.ALLOW_LEGACY_SERVER_ENCRYPTION !== "1") {
  console.error("This legacy enc:v1 migration is deprecated. Use migrate:client-encryption instead.");
  console.error("Set ALLOW_LEGACY_SERVER_ENCRYPTION=1 only for an intentional one-off legacy recovery.");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const key = decodeKey(process.env.APP_ENCRYPTION_KEY);

if (!url || !serviceRoleKey || !key) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or APP_ENCRYPTION_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

for (const [table, fields] of tableFields) {
  await encryptTable(supabase, table, fields, key);
}
await encryptMarkdownBackups(supabase, key);
await encryptPhotoStorage(supabase, key);
