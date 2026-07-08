import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const HEADER_PREFIX = "MWBLOG_FILE_V1 ";
const UNAVAILABLE_MIME = "application/octet-stream";

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

export function isPrivateFileEncrypted(buffer: Buffer) {
  return buffer.subarray(0, HEADER_PREFIX.length).toString("utf8") === HEADER_PREFIX;
}

export function encryptPrivateFile(buffer: Buffer, mimeType: string) {
  if (isPrivateFileEncrypted(buffer)) return buffer;

  const key = appKey();
  if (!key) {
    throw new Error("Missing APP_ENCRYPTION_KEY. Refusing to store photo bytes in plaintext.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const header = Buffer.from(`${HEADER_PREFIX}${JSON.stringify({
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    mimeType: mimeType || UNAVAILABLE_MIME,
  })}\n`, "utf8");

  return Buffer.concat([header, ciphertext]);
}

export function decryptPrivateFile(buffer: Buffer, fallbackMimeType = UNAVAILABLE_MIME) {
  if (!isPrivateFileEncrypted(buffer)) {
    return { buffer, mimeType: fallbackMimeType };
  }

  const key = appKey();
  if (!key) {
    throw new Error("Missing APP_ENCRYPTION_KEY. Cannot decrypt private photo.");
  }

  const newline = buffer.indexOf(10);
  if (newline <= HEADER_PREFIX.length) {
    throw new Error("Invalid encrypted photo header.");
  }

  const header = JSON.parse(buffer.subarray(HEADER_PREFIX.length, newline).toString("utf8"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(header.tag, "base64url"));

  return {
    buffer: Buffer.concat([decipher.update(buffer.subarray(newline + 1)), decipher.final()]),
    mimeType: String(header.mimeType || fallbackMimeType),
  };
}
