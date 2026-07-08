export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isAllowedImageType(type: string) {
  return ALLOWED_IMAGE_TYPES.has(type.toLowerCase());
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
