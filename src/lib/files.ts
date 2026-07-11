export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isAllowedImageType(type: string) {
  return ALLOWED_IMAGE_TYPES.has(normalizeImageType(type));
}

export function normalizeImageType(type: string) {
  const normalized = type.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function detectImageType(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    view.length >= 6 &&
    view[0] === 0x47 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x38 &&
    (view[4] === 0x37 || view[4] === 0x39) &&
    view[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    view.length >= 12 &&
    view[0] === 0x52 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x46 &&
    view[8] === 0x57 &&
    view[9] === 0x45 &&
    view[10] === 0x42 &&
    view[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateImageUpload(bytes: ArrayBuffer | Uint8Array, declaredType = "") {
  const detectedType = detectImageType(bytes);
  if (!detectedType) return null;

  const normalizedDeclared = normalizeImageType(declaredType);
  if (normalizedDeclared && normalizedDeclared !== detectedType) {
    return null;
  }

  return detectedType;
}

export function extensionFromName(name: string, type = "") {
  const nameExt = name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
  if (nameExt) return nameExt;

  const mimeExt = type.split("/")[1]?.toLowerCase();
  if (mimeExt === "jpeg") return "jpg";
  return mimeExt && /^[a-z0-9]+$/.test(mimeExt) ? mimeExt : "bin";
}

export function extensionFromFile(file: File) {
  return extensionFromName(file.name, file.type);
}

export function storageSafeName(value: string, fallback = "file") {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  return base || fallback;
}

export function isOwnedStoragePath(value: string, ownerId: string) {
  const path = String(value || "").trim();
  const owner = String(ownerId || "").trim();
  if (!path || !owner || path.startsWith("/") || path.includes("\\")) return false;

  const segments = path.split("/");
  return segments.length >= 2
    && segments[0] === owner
    && segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..");
}
