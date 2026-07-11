const TEXT_PREFIX = "enc:wc2:";
const FILE_PREFIX = "MWBLOG-WC2 ";
const PREVIOUS_TEXT_PREFIX = "enc:wc1:";
const PREVIOUS_FILE_PREFIX = "MWBLOG-WC1 ";
const LEGACY_TEXT_PREFIX = "enc:v1:";
const LEGACY_FILE_PREFIX = "MWBLOG_FILE_V1 ";

export const PRIVATE_TEXT_PREFIX = TEXT_PREFIX;
export const PRIVATE_FILE_PREFIX = FILE_PREFIX;
export const PREVIOUS_PRIVATE_TEXT_PREFIX = PREVIOUS_TEXT_PREFIX;
export const PREVIOUS_PRIVATE_FILE_PREFIX = PREVIOUS_FILE_PREFIX;
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
  return typeof value === "string" && (value.startsWith(TEXT_PREFIX) || value.startsWith(PREVIOUS_TEXT_PREFIX));
}

export function isLegacyEncryptedText(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(LEGACY_TEXT_PREFIX);
}

export function readEncryptedText(value: unknown, options?: { allowEmpty?: boolean; maxLength?: number; context?: string }) {
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
  const current = normalized.startsWith(TEXT_PREFIX);
  if (options?.context && !current) {
    throw new Error("Sensitive content must use the current client-encryption format.");
  }
  const prefix = current ? TEXT_PREFIX : PREVIOUS_TEXT_PREFIX;
  const encoded = normalized.slice(prefix.length);
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
    const context = String(parsed?.context || "");
    const ivBytes = decodeBase64Url(iv);
    const dataBytes = decodeBase64Url(data);
    if (
      !isBase64Url(iv)
      || !isBase64Url(data)
      || ivBytes?.length !== 12
      || !dataBytes
      || dataBytes.length < 16
      || (current && (!context || context.length > 64))
      || (options?.context && context !== options.context)
    ) {
      throw new Error("invalid payload");
    }
  } catch {
    throw new Error("Encrypted content format is invalid.");
  }
  return normalized;
}

export function readNullableEncryptedText(value: unknown, options?: { maxLength?: number; context?: string }) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return readEncryptedText(normalized, { maxLength: options?.maxLength, context: options?.context });
}

export function isClientEncryptedFile(buffer: Uint8Array) {
  const prefix = new TextEncoder().encode(FILE_PREFIX);
  const previous = new TextEncoder().encode(PREVIOUS_FILE_PREFIX);
  return prefix.every((value, index) => buffer[index] === value)
    || previous.every((value, index) => buffer[index] === value);
}

export function parseEncryptedFileHeader(buffer: Uint8Array) {
  const currentPrefix = new TextEncoder().encode(FILE_PREFIX);
  const previousPrefix = new TextEncoder().encode(PREVIOUS_FILE_PREFIX);
  const isCurrent = currentPrefix.every((value, index) => buffer[index] === value);
  const headerPrefix = isCurrent ? currentPrefix : previousPrefix;
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
  const context = String(parsed?.context || "");
  if (
    !iv
    || !mimeType
    || !isBase64Url(iv)
    || iv.length !== 16
    || tag !== "packed"
    || (isCurrent && context !== "photo.file")
    || buffer.length - newline - 1 < 16
  ) {
    throw new Error("Encrypted file header is incomplete.");
  }

  return {
    header: parsed,
    mimeType,
    newline,
    context,
    current: isCurrent,
  };
}

export function isLegacyEncryptedFile(buffer: Uint8Array) {
  const prefix = new TextEncoder().encode(LEGACY_FILE_PREFIX);
  return prefix.every((value, index) => buffer[index] === value);
}
