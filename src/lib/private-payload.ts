const TEXT_PREFIX = "enc:wc1:";
const FILE_PREFIX = "MWBLOG-WC1 ";
const LEGACY_TEXT_PREFIX = "enc:v1:";
const LEGACY_FILE_PREFIX = "MWBLOG_FILE_V1 ";

export const PRIVATE_TEXT_PREFIX = TEXT_PREFIX;
export const PRIVATE_FILE_PREFIX = FILE_PREFIX;
export const LEGACY_PRIVATE_TEXT_PREFIX = LEGACY_TEXT_PREFIX;
export const LEGACY_PRIVATE_FILE_PREFIX = LEGACY_FILE_PREFIX;

function isBase64Url(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function decodeBase64Url(value: string) {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

export function isClientEncryptedText(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(TEXT_PREFIX);
}

export function isLegacyEncryptedText(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(LEGACY_TEXT_PREFIX);
}

export function readEncryptedText(value: unknown, options?: { allowEmpty?: boolean; maxLength?: number }) {
  const normalized = String(value ?? "").trim();
  const allowEmpty = Boolean(options?.allowEmpty);
  if (!normalized) {
    if (allowEmpty) return "";
    throw new Error("Missing encrypted content.");
  }
  if (!isClientEncryptedText(normalized)) {
    throw new Error("Sensitive content must be client-encrypted.");
  }
  if (options?.maxLength && normalized.length > options.maxLength) {
    throw new Error("Encrypted content is too large.");
  }
  const encoded = normalized.slice(TEXT_PREFIX.length);
  if (!encoded || !isBase64Url(encoded)) {
    throw new Error("Encrypted content format is invalid.");
  }
  const decoded = decodeBase64Url(encoded);
  if (!decoded || decoded.length < 16 || decoded.length > (options?.maxLength || 4096)) {
    throw new Error("Encrypted content format is invalid.");
  }
  try {
    const parsed = JSON.parse(decoded.toString("utf8"));
    const iv = String(parsed?.iv || "");
    const data = String(parsed?.data || "");
    const ivBytes = decodeBase64Url(iv);
    const dataBytes = decodeBase64Url(data);
    if (
      !isBase64Url(iv)
      || !isBase64Url(data)
      || ivBytes?.length !== 12
      || !dataBytes
      || dataBytes.length < 16
    ) {
      throw new Error("invalid payload");
    }
  } catch {
    throw new Error("Encrypted content format is invalid.");
  }
  return normalized;
}

export function readNullableEncryptedText(value: unknown, options?: { maxLength?: number }) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return readEncryptedText(normalized, { maxLength: options?.maxLength });
}

export function isClientEncryptedFile(buffer: Uint8Array) {
  const prefix = new TextEncoder().encode(FILE_PREFIX);
  return prefix.every((value, index) => buffer[index] === value);
}

export function parseEncryptedFileHeader(buffer: Uint8Array) {
  const headerPrefix = new TextEncoder().encode(FILE_PREFIX);
  const prefix = buffer.subarray(0, headerPrefix.length);
  if (prefix.length !== headerPrefix.length || prefix.some((value, index) => value !== headerPrefix[index])) {
    throw new Error("Encrypted file header is missing.");
  }

  const newline = buffer.indexOf(10);
  if (newline <= headerPrefix.length || newline > 1024) {
    throw new Error("Encrypted file header is invalid.");
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer.subarray(headerPrefix.length, newline)));
  } catch {
    throw new Error("Encrypted file header could not be parsed.");
  }

  const iv = String(parsed?.iv || "");
  const mimeType = String(parsed?.mimeType || "").trim().toLowerCase();
  const tag = String(parsed?.tag || "");
  if (
    !iv
    || !mimeType
    || !isBase64Url(iv)
    || iv.length !== 16
    || tag !== "packed"
    || buffer.length - newline - 1 < 16
  ) {
    throw new Error("Encrypted file header is incomplete.");
  }

  return {
    header: parsed,
    mimeType,
    newline,
  };
}

export function isLegacyEncryptedFile(buffer: Uint8Array) {
  const prefix = new TextEncoder().encode(LEGACY_FILE_PREFIX);
  return prefix.every((value, index) => buffer[index] === value);
}
