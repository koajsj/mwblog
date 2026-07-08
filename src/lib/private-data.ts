import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const UNAVAILABLE = "[Encrypted content unavailable]";

function decodeKey(raw: string) {
  const value = raw.trim();
  if (!value) return null;

  if (/^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to passphrase hashing.
  }

  return createHash("sha256").update(value).digest();
}

function appKey() {
  return decodeKey(import.meta.env.APP_ENCRYPTION_KEY || "");
}

export function hasPrivateDataKey() {
  return Boolean(appKey());
}

export function encryptPrivateText(value: string) {
  if (!value || value.startsWith(PREFIX)) return value;
  const key = appKey();
  if (!key) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function encryptNullablePrivateText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? encryptPrivateText(normalized) : null;
}

export function decryptPrivateText(value: string | null | undefined) {
  if (!value) return value || "";
  if (!value.startsWith(PREFIX)) return value;

  const key = appKey();
  if (!key) return UNAVAILABLE;

  try {
    const [ivRaw, tagRaw, dataRaw] = value.slice(PREFIX.length).split(":");
    if (!ivRaw || !tagRaw || !dataRaw) return UNAVAILABLE;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return UNAVAILABLE;
  }
}

export function decryptPrivateFields<T extends object>(row: T, fields: Array<keyof T>) {
  const next = { ...row };
  fields.forEach((field) => {
    const value = next[field];
    if (typeof value === "string") {
      next[field] = decryptPrivateText(value) as T[keyof T];
    }
  });
  return next;
}

export function decryptPrivateRows<T extends object>(rows: T[], fields: Array<keyof T>) {
  return rows.map((row) => decryptPrivateFields(row, fields));
}
