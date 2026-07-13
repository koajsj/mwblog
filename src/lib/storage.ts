import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServiceClient } from "./local-store";
import { storageRoot } from "./local-store";

let checked = false;

async function ensureBucket(name: string) {
  await mkdir(join(storageRoot, name), { recursive: true, mode: 0o700 });
}

export async function ensureStorageBuckets() {
  if (checked) return;

  await ensureBucket("photos");
  await ensureBucket("blog-markdown");

  checked = true;
}

export async function attachPrivatePhotoUrls<T extends { id: string; storage_path: string }>(photos: T[]) {
  return photos.map((photo) => ({
    ...photo,
    publicUrl: `/api/photos/file?id=${encodeURIComponent(photo.id)}`,
  }));
}

export async function storageObjectExists(store: ReturnType<typeof createServiceClient>, bucket: string, path: string) {
  const cleanPath = path.replace(/^\/+/, "");
  const slash = cleanPath.lastIndexOf("/");
  const folder = slash >= 0 ? cleanPath.slice(0, slash) : "";
  const filename = slash >= 0 ? cleanPath.slice(slash + 1) : cleanPath;
  if (!filename) return false;

  const { data, error } = await store.storage.from(bucket).list(folder, {
    limit: 1,
    search: filename,
  });

  if (error) return false;
  return Boolean((data || []).some((item) => item.name === filename));
}

export async function removeStoragePaths(_store: unknown, bucket: string, paths: string[]) {
  const cleanPaths = paths.map((path) => path.trim()).filter(Boolean);
  if (!cleanPaths.length) return;
  await createServiceClient().storage.from(bucket).remove(cleanPaths);
}
