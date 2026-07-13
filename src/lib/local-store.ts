import { createHash, randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import type { Profile } from "./types.ts";
import { validateProductionEnvironment } from "./env.ts";

const SPACE_ID = "private-couple-space";
validateProductionEnvironment();
const DEFAULT_DATA_DIR = join(process.cwd(), ".data");
export const appDataDir = resolve(process.env.APP_DATA_DIR || DEFAULT_DATA_DIR);
export const databasePath = join(appDataDir, "our-nest.sqlite");
export const storageRoot = join(appDataDir, "storage");

mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
accessSync(appDataDir, constants.R_OK | constants.W_OK);

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL UNIQUE CHECK (account IN ('kikou', 'scoinmic')),
    author_key TEXT NOT NULL UNIQUE CHECK (author_key IN ('white', 'brown')),
    display_name TEXT NOT NULL,
    weather_text TEXT,
    weather_updated_at TEXT,
    weather_lat REAL,
    weather_lng REAL,
    weather_label TEXT,
    mood_text TEXT,
    mood_date TEXT,
    doing_text TEXT,
    doing_date TEXT,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blog_posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT,
    content_markdown TEXT NOT NULL,
    storage_path TEXT,
    author_id TEXT NOT NULL REFERENCES profiles(id),
    tags TEXT NOT NULL DEFAULT '[]',
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS life_records (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id),
    record_on TEXT NOT NULL,
    mood TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS activity_entries (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id),
    activity_on TEXT NOT NULL,
    period TEXT NOT NULL,
    category TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    body TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id),
    name TEXT NOT NULL,
    note TEXT NOT NULL,
    tone TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id),
    title TEXT,
    caption TEXT,
    taken_on TEXT,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT,
    created_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('blog', 'record')),
    target_id TEXT NOT NULL,
    author_id TEXT NOT NULL REFERENCES profiles(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id),
    title TEXT NOT NULL,
    due_on TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_on TEXT,
    completed_start_time TEXT,
    completed_end_time TEXT,
    completed_minutes INTEGER NOT NULL DEFAULT 0,
    activity_entry_id TEXT REFERENCES activity_entries(id) ON DELETE SET NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}'
  );

  CREATE TABLE IF NOT EXISTS todo_activity_entries (
    todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    activity_entry_id TEXT NOT NULL REFERENCES activity_entries(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    space_id TEXT NOT NULL DEFAULT '${SPACE_ID}',
    PRIMARY KEY (todo_id, activity_entry_id)
  );

  CREATE TABLE IF NOT EXISTS private_space_keys (
    space_id TEXT PRIMARY KEY,
    bundle TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES profiles(id),
    updated_by TEXT NOT NULL REFERENCES profiles(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS blog_posts_published_idx ON blog_posts(published_at DESC);
  CREATE INDEX IF NOT EXISTS photos_created_idx ON photos(created_at DESC);
  CREATE INDEX IF NOT EXISTS life_records_date_idx ON life_records(record_on DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS activity_entries_date_idx ON activity_entries(activity_on DESC, start_time);
  CREATE INDEX IF NOT EXISTS todos_owner_idx ON todos(owner_id, archived_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS comments_target_idx ON comments(target_type, target_id, created_at);

  CREATE TRIGGER IF NOT EXISTS delete_blog_comments AFTER DELETE ON blog_posts
  BEGIN DELETE FROM comments WHERE target_type = 'blog' AND target_id = OLD.id; END;
  CREATE TRIGGER IF NOT EXISTS delete_record_comments AFTER DELETE ON life_records
  BEGIN DELETE FROM comments WHERE target_type = 'record' AND target_id = OLD.id; END;
`);
const schemaVersion = Number((db.prepare("PRAGMA user_version").get() as { user_version?: number })?.user_version || 0);
if (schemaVersion > 1) throw new Error(`Database schema ${schemaVersion} is newer than this application supports.`);
if (schemaVersion === 0) db.exec("PRAGMA user_version = 1");
const quickCheck = db.prepare("PRAGMA quick_check").get() as { quick_check?: string };
if (quickCheck.quick_check !== "ok") throw new Error("SQLite quick check failed.");
chmodSync(databasePath, 0o600);

const fixedProfiles = [
  ["00000000-0000-4000-8000-000000000001", "kikou", "white", "kikou"],
  ["00000000-0000-4000-8000-000000000002", "scoinmic", "brown", "scoinmic"],
] as const;
const seedProfile = db.prepare(`
  INSERT INTO profiles (id, account, author_key, display_name, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    account = excluded.account,
    author_key = excluded.author_key,
    display_name = excluded.display_name
`);
for (const profile of fixedProfiles) seedProfile.run(...profile, new Date().toISOString());

function walkStorageFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walkStorageFiles(path) : [path];
  });
}

function cleanupOrphanStorage() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const buckets = [
    { name: "photos", rows: db.prepare("SELECT storage_path FROM photos").all() as Array<{ storage_path: string }> },
    { name: "blog-markdown", rows: db.prepare("SELECT storage_path FROM blog_posts WHERE storage_path IS NOT NULL").all() as Array<{ storage_path: string }> },
  ];
  for (const bucket of buckets) {
    const root = resolve(storageRoot, bucket.name);
    const committed = new Set(bucket.rows.map((row) => resolve(root, ...row.storage_path.split("/"))));
    for (const path of walkStorageFiles(root)) {
      if (!committed.has(path) && statSync(path).mtimeMs < cutoff) unlinkSync(path);
    }
  }
}

cleanupOrphanStorage();

const TABLES = new Set([
  "profiles", "blog_posts", "photos", "life_records", "activity_entries", "places", "comments",
  "todos", "todo_activity_entries", "private_space_keys",
]);
const OWNER_COLUMNS: Record<string, string> = {
  blog_posts: "author_id",
  photos: "owner_id",
  life_records: "owner_id",
  activity_entries: "owner_id",
  places: "owner_id",
  comments: "author_id",
  todos: "owner_id",
};
const JSON_COLUMNS = new Set(["blog_posts.tags", "private_space_keys.bundle"]);
const BOOLEAN_COLUMNS = new Set(["todos.completed"]);
const PROFILE_UPDATE_COLUMNS = new Set([
  "weather_text", "weather_updated_at", "weather_lat", "weather_lng", "weather_label",
  "mood_text", "mood_date", "doing_text", "doing_date",
]);

type DbValue = string | number | bigint | null;
type Filter = { column: string; operator: "=" | "IN" | "IS" | "IS NOT" | ">=" | "<"; value: unknown };
type Result = { data: any; error: null | { message: string; code?: string } };

function safeIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Invalid database identifier.");
  return value;
}

function dbValue(table: string, column: string, value: unknown): DbValue {
  if (value === undefined || value === null) return null;
  if (JSON_COLUMNS.has(`${table}.${column}`)) return JSON.stringify(value);
  if (BOOLEAN_COLUMNS.has(`${table}.${column}`)) return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  return JSON.stringify(value);
}

function parseRow(table: string, row: Record<string, unknown>) {
  const parsed = { ...row } as Record<string, any>;
  for (const column of Object.keys(parsed)) {
    if (JSON_COLUMNS.has(`${table}.${column}`) && typeof parsed[column] === "string") {
      try { parsed[column] = JSON.parse(parsed[column]); } catch { parsed[column] = column === "tags" ? [] : null; }
    }
    if (BOOLEAN_COLUMNS.has(`${table}.${column}`)) parsed[column] = Boolean(parsed[column]);
  }
  return parsed;
}

function splitSelection(selection: string) {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selection.length; index += 1) {
    const char = selection[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      fields.push(selection.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(selection.slice(start).trim());
  return fields.filter(Boolean);
}

function projectRows(table: string, rows: Record<string, any>[], selection: string) {
  if (!selection || selection === "*") return rows;
  const fields = splitSelection(selection);
  const profileField = fields.find((field) => field.startsWith("profiles("));
  const activityField = fields.find((field) => field.startsWith("activity_entries("));
  const directFields = fields.filter((field) => !field.includes("("));
  return rows.map((row) => {
    const projected: Record<string, any> = {};
    for (const field of directFields) projected[safeIdentifier(field)] = row[field];
    if (profileField) {
      const profileId = row.author_id || row.owner_id;
      const profile = profileId
        ? db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId) as Record<string, unknown> | undefined
        : undefined;
      const inner = profileField.slice("profiles(".length, -1);
      projected.profiles = profile ? projectRows("profiles", [parseRow("profiles", profile)], inner)[0] : null;
    }
    if (activityField) {
      const activity = row.activity_entry_id
        ? db.prepare("SELECT * FROM activity_entries WHERE id = ?").get(row.activity_entry_id) as Record<string, unknown> | undefined
        : undefined;
      const inner = activityField.slice("activity_entries(".length, -1);
      projected.activity_entries = activity ? projectRows("activity_entries", [parseRow("activity_entries", activity)], inner)[0] : null;
    }
    return projected;
  });
}

class LocalQuery {
  private table: string;
  private userId: string | null;
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private selection = "*";
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private maxRows: number | null = null;
  private one: "single" | "maybe" | null = null;
  private conflictColumn = "id";

  constructor(table: string, userId: string | null) {
    if (!TABLES.has(table)) throw new Error("Unknown database table.");
    this.table = table;
    this.userId = userId;
  }

  select(selection = "*") { this.selection = selection; return this; }
  insert(payload: Record<string, unknown> | Record<string, unknown>[]) { this.action = "insert"; this.payload = payload; return this; }
  update(payload: Record<string, unknown>) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  upsert(payload: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }) {
    this.action = "upsert";
    this.payload = payload;
    this.conflictColumn = safeIdentifier(options?.onConflict || "id");
    return this;
  }
  eq(column: string, value: unknown) { this.filters.push({ column: safeIdentifier(column), operator: "=", value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column: safeIdentifier(column), operator: "IN", value }); return this; }
  is(column: string, value: null) { this.filters.push({ column: safeIdentifier(column), operator: "IS", value }); return this; }
  not(column: string, operator: "is", value: null) { this.filters.push({ column: safeIdentifier(column), operator: "IS NOT", value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ column: safeIdentifier(column), operator: ">=", value }); return this; }
  lt(column: string, value: unknown) { this.filters.push({ column: safeIdentifier(column), operator: "<", value }); return this; }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column: safeIdentifier(column), ascending: options?.ascending !== false });
    return this;
  }
  limit(value: number) { this.maxRows = Math.max(0, Math.floor(value)); return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  private assertWriteAccess(rows: Record<string, unknown>[]) {
    if (!this.userId) throw new Error("Authentication is required.");
    const ownerColumn = OWNER_COLUMNS[this.table];
    if (ownerColumn && rows.some((row) => ownerColumn in row && row[ownerColumn] !== this.userId)) {
      throw new Error("Cannot write data owned by another account.");
    }
    if (this.table === "profiles") {
      for (const row of rows) {
        for (const column of Object.keys(row)) {
          if (!PROFILE_UPDATE_COLUMNS.has(column)) throw new Error("Profile identity fields cannot be changed.");
        }
      }
    }
    if (this.table === "private_space_keys" && rows.some((row) => (
      ("created_by" in row && row.created_by !== this.userId)
      || ("updated_by" in row && row.updated_by !== this.userId)
    ))) {
      throw new Error("Invalid private-space key owner.");
    }
    if (this.table === "todo_activity_entries") {
      for (const row of rows) {
        const owned = db.prepare(`
          SELECT 1 FROM todos
          JOIN activity_entries ON activity_entries.id = ?
          WHERE todos.id = ? AND todos.owner_id = ? AND activity_entries.owner_id = ?
        `).get(row.activity_entry_id as string, row.todo_id as string, this.userId, this.userId);
        if (!owned) throw new Error("Cannot link data owned by another account.");
      }
    }
  }

  private whereClause(includeOwnership: boolean) {
    const filters = [...this.filters];
    const ownerColumn = OWNER_COLUMNS[this.table];
    if (includeOwnership && ownerColumn && this.userId) {
      filters.push({ column: ownerColumn, operator: "=", value: this.userId });
    }
    if (includeOwnership && this.table === "profiles" && this.userId) {
      filters.push({ column: "id", operator: "=", value: this.userId });
    }
    const values: DbValue[] = [];
    const clauses = filters.map((filter) => {
      if (filter.operator === "IN") {
        const items = Array.isArray(filter.value) ? filter.value : [];
        if (!items.length) return "0 = 1";
        values.push(...items.map((item) => dbValue(this.table, filter.column, item)));
        return `${filter.column} IN (${items.map(() => "?").join(", ")})`;
      }
      if (filter.operator === "IS" || filter.operator === "IS NOT") return `${filter.column} ${filter.operator} NULL`;
      values.push(dbValue(this.table, filter.column, filter.value));
      return `${filter.column} ${filter.operator} ?`;
    });
    if (includeOwnership && this.table === "todo_activity_entries" && this.userId) {
      clauses.push("EXISTS (SELECT 1 FROM todos WHERE todos.id = todo_activity_entries.todo_id AND todos.owner_id = ?)");
      values.push(this.userId);
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
  }

  private readRows(includeOwnership = false) {
    const where = this.whereClause(includeOwnership);
    const order = this.orders.length
      ? ` ORDER BY ${this.orders.map((item) => `${item.column} ${item.ascending ? "ASC" : "DESC"}`).join(", ")}`
      : "";
    const limit = this.maxRows === null ? "" : ` LIMIT ${this.maxRows}`;
    const rows = db.prepare(`SELECT * FROM ${this.table}${where.sql}${order}${limit}`).all(...where.values) as Record<string, unknown>[];
    return rows.map((row) => parseRow(this.table, row));
  }

  private insertRows(upsert: boolean) {
    const source = Array.isArray(this.payload) ? this.payload : [this.payload || {}];
    const now = new Date().toISOString();
    const rows = source.map((input) => {
      const row = { ...input } as Record<string, unknown>;
      if (!row.id && !["profiles", "todo_activity_entries", "private_space_keys"].includes(this.table)) row.id = randomUUID();
      if (!("created_at" in row)) row.created_at = now;
      if (["blog_posts", "life_records", "activity_entries", "places", "todos"].includes(this.table) && !("updated_at" in row)) row.updated_at = now;
      if (this.table === "blog_posts" && !("published_at" in row)) row.published_at = now;
      if (this.table !== "private_space_keys" && this.table !== "profiles") row.space_id = SPACE_ID;
      if (this.table === "private_space_keys" && !("created_at" in row)) row.created_at = now;
      return row;
    });
    this.assertWriteAccess(rows);

    const inserted: Record<string, any>[] = [];
    for (const row of rows) {
      if (upsert && this.table === "blog_posts" && this.conflictColumn === "slug") {
        const existing = db.prepare("SELECT author_id FROM blog_posts WHERE slug = ?").get(dbValue(this.table, "slug", row.slug)) as { author_id?: string } | undefined;
        if (existing && existing.author_id !== this.userId) throw new Error("That slug belongs to another account.");
      }
      const columns = Object.keys(row).map(safeIdentifier);
      const values = columns.map((column) => dbValue(this.table, column, row[column]));
      const update = columns
        .filter((column) => column !== this.conflictColumn && column !== "created_at")
        .map((column) => `${column} = excluded.${column}`)
        .join(", ");
      const conflict = upsert ? ` ON CONFLICT(${this.conflictColumn}) DO UPDATE SET ${update}` : "";
      db.prepare(`INSERT INTO ${this.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})${conflict}`).run(...values);
      const keyColumn = this.conflictColumn in row ? this.conflictColumn : ("id" in row ? "id" : null);
      if (keyColumn) {
        const stored = db.prepare(`SELECT * FROM ${this.table} WHERE ${keyColumn} = ?`).get(dbValue(this.table, keyColumn, row[keyColumn])) as Record<string, unknown>;
        inserted.push(parseRow(this.table, stored));
      } else {
        inserted.push(parseRow(this.table, row));
      }
    }
    return inserted;
  }

  private run(): Result {
    try {
      let rows: Record<string, any>[] = [];
      if (this.action === "select") {
        rows = this.readRows(false);
      } else if (this.action === "insert" || this.action === "upsert") {
        rows = this.insertRows(this.action === "upsert");
      } else if (this.action === "update") {
        const payload = { ...(this.payload as Record<string, unknown>) };
        this.assertWriteAccess([payload]);
        if (["blog_posts", "life_records", "activity_entries", "places", "todos"].includes(this.table)) payload.updated_at = new Date().toISOString();
        const columns = Object.keys(payload).map(safeIdentifier);
        if (!columns.length) throw new Error("No fields to update.");
        const rowsToUpdate = this.readRows(true);
        if (!rowsToUpdate.length) {
          rows = [];
        } else {
        const where = this.whereClause(true);
        const result = db.prepare(`UPDATE ${this.table} SET ${columns.map((column) => `${column} = ?`).join(", ")}${where.sql}`)
          .run(...columns.map((column) => dbValue(this.table, column, payload[column])), ...where.values);
          rows = result.changes ? rowsToUpdate.map((row) => parseRow(this.table, { ...row, ...payload })) : [];
        }
      } else {
        const rowsToDelete = this.readRows(true);
        const where = this.whereClause(true);
        db.prepare(`DELETE FROM ${this.table}${where.sql}`).run(...where.values);
        rows = rowsToDelete;
      }
      const projected = projectRows(this.table, rows, this.selection);
      if (this.one) {
        if (projected.length > 1 || (this.one === "single" && projected.length !== 1)) {
          return { data: null, error: { message: "Expected one row.", code: "PGRST116" } };
        }
        return { data: projected[0] || null, error: null };
      }
      return { data: projected, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database operation failed.";
      return { data: null, error: { message, code: /UNIQUE constraint failed/i.test(message) ? "23505" : undefined } };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

function safeStoragePath(bucket: string, objectPath = "") {
  if (!/^[a-z][a-z0-9-]*$/.test(bucket)) throw new Error("Invalid storage bucket.");
  const clean = posix.normalize(objectPath.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!clean || clean === "." || clean.startsWith("../") || clean.includes("/../")) throw new Error("Invalid storage path.");
  const root = resolve(storageRoot, bucket);
  const target = resolve(root, ...clean.split("/"));
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Invalid storage path.");
  return { root, target, clean };
}

class LocalBucket {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(objectPath: string, source: Blob | Uint8Array | ArrayBuffer | string, options?: { upsert?: boolean }) {
    if (activeUploads >= 2) return { data: null, error: { message: "Too many uploads are already in progress." } };
    activeUploads += 1;
    try {
      const { target } = safeStoragePath(this.bucket, objectPath);
      const sourceBytes = typeof source === "string"
        ? Buffer.byteLength(source)
        : source instanceof Blob
          ? source.size
          : source instanceof Uint8Array
            ? source.byteLength
            : source.byteLength;
      const limits = STORAGE_LIMITS[this.bucket];
      if (!limits) throw new Error("Unknown storage bucket.");
      if (sourceBytes > limits.maxFileBytes) throw new Error("File is larger than the allowed limit.");
      const existingFiles = walkStorageFiles(resolve(storageRoot, this.bucket));
      if (!existsSync(target) && existingFiles.length >= limits.maxFiles) throw new Error("Storage file limit reached.");
      const usedBytes = existingFiles.reduce((sum, path) => sum + statSync(path).size, 0);
      const replacedBytes = existsSync(target) ? statSync(target).size : 0;
      if (usedBytes - replacedBytes + sourceBytes > limits.maxTotalBytes) throw new Error("Storage capacity limit reached.");
      await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
      if (!options?.upsert && existsSync(target)) throw new Error("Object already exists.");
      if (source instanceof Blob) {
        await pipeline(Readable.fromWeb(source.stream() as any), createWriteStream(target, { flags: options?.upsert ? "w" : "wx", mode: 0o600 }));
      } else {
        const bytes = typeof source === "string" ? source : source instanceof Uint8Array ? source : new Uint8Array(source);
        await writeFile(target, bytes, { flag: options?.upsert ? "w" : "wx", mode: 0o600 });
      }
      return { data: { path: objectPath }, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "Storage upload failed." } };
    } finally {
      activeUploads -= 1;
    }
  }

  async download(objectPath: string) {
    try {
      const { target } = safeStoragePath(this.bucket, objectPath);
      const data = await readFile(target);
      return { data: new Blob([data]), error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "Storage download failed." } };
    }
  }

  async remove(paths: string[]) {
    try {
      for (const objectPath of paths) {
        const { target } = safeStoragePath(this.bucket, objectPath);
        if (existsSync(target)) unlinkSync(target);
      }
      return { data: paths, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "Storage removal failed." } };
    }
  }

  async list(folder = "", options?: { limit?: number; search?: string }) {
    try {
      const marker = `${folder.replace(/^\/+|\/+$/g, "")}/.keep`;
      const { target } = safeStoragePath(this.bucket, marker);
      const directory = resolve(target, "..");
      if (!existsSync(directory)) return { data: [], error: null };
      const entries = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => !options?.search || entry.name.includes(options.search))
        .slice(0, options?.limit || 100)
        .map((entry) => ({ name: entry.name, id: entry.isFile() ? entry.name : null }));
      return { data: entries, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "Storage listing failed." } };
    }
  }
}

const STORAGE_LIMITS: Record<string, { maxFileBytes: number; maxFiles: number; maxTotalBytes: number }> = {
  photos: { maxFileBytes: 50 * 1024 * 1024, maxFiles: 5000, maxTotalBytes: 5 * 1024 * 1024 * 1024 },
  "blog-markdown": { maxFileBytes: 4 * 1024 * 1024, maxFiles: 2000, maxTotalBytes: 200 * 1024 * 1024 },
};
let activeUploads = 0;

class LocalClient {
  private userId: string | null;

  constructor(userId: string | null) {
    this.userId = userId;
  }
  from(table: string) { return new LocalQuery(table, this.userId); }
  storage = { from: (bucket: string) => new LocalBucket(bucket) };
}

export function createLocalsClient(locals: App.Locals) {
  return new LocalClient(locals.user?.id || null);
}

export function createServiceClient() {
  return new LocalClient(null);
}

export function profileById(id: string) {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? parseRow("profiles", row) as Profile : null;
}

export function profileByAccount(account: string) {
  const row = db.prepare("SELECT * FROM profiles WHERE lower(account) = lower(?)").get(account) as Record<string, unknown> | undefined;
  return row ? parseRow("profiles", row) as Profile : null;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: string, token: string, expiresAt: string) {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(hashSessionToken(token), userId, expiresAt, now);
}

export function readSessionProfile(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db.prepare(`
    SELECT profiles.* FROM sessions
    JOIN profiles ON profiles.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashSessionToken(token), new Date().toISOString()) as Record<string, unknown> | undefined;
  return row ? parseRow("profiles", row) as Profile : null;
}

export function deleteSession(token: string) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
}

export function storageFilePath(bucket: string, objectPath: string) {
  return safeStoragePath(bucket, objectPath).target;
}

export function storageFileStream(bucket: string, objectPath: string) {
  const target = storageFilePath(bucket, objectPath);
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return createReadStream(target);
}
