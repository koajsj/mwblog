import { createServiceClient } from "./supabase";

let checked = false;

async function ensureBucket(
  name: string,
  options: { public: boolean; fileSizeLimit: number; allowedMimeTypes?: string[] },
) {
  const service = createServiceClient();
  const { data } = await service.storage.getBucket(name);

  if (data) {
    const { error } = await service.storage.updateBucket(name, {
      public: options.public,
      fileSizeLimit: options.fileSizeLimit,
      allowedMimeTypes: options.allowedMimeTypes,
    });
    if (error) {
      throw new Error(`Failed to update storage bucket ${name}: ${error.message}`);
    }
    return;
  }

  const { error } = await service.storage.createBucket(name, {
    public: options.public,
    fileSizeLimit: options.fileSizeLimit,
    allowedMimeTypes: options.allowedMimeTypes,
  });

  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Failed to create storage bucket ${name}: ${error.message}`);
  }
}

export async function ensureStorageBuckets() {
  if (checked) return;

  await ensureBucket("photos", {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/octet-stream", "image/jpeg", "image/png", "image/webp", "image/gif"],
  });

  await ensureBucket("blog-markdown", {
    public: false,
    fileSizeLimit: 1024 * 1024,
    allowedMimeTypes: ["text/markdown", "text/plain"],
  });

  checked = true;
}

export async function attachPrivatePhotoUrls<T extends { id: string; storage_path: string }>(photos: T[]) {
  return photos.map((photo) => ({
    ...photo,
    publicUrl: `/api/photos/file?id=${encodeURIComponent(photo.id)}`,
  }));
}

export async function storageObjectExists(bucket: string, path: string) {
  const cleanPath = path.replace(/^\/+/, "");
  const slash = cleanPath.lastIndexOf("/");
  const folder = slash >= 0 ? cleanPath.slice(0, slash) : "";
  const filename = slash >= 0 ? cleanPath.slice(slash + 1) : cleanPath;
  if (!filename) return false;

  const service = createServiceClient();
  const { data, error } = await service.storage.from(bucket).list(folder, {
    limit: 1,
    search: filename,
  });

  if (error) return false;
  return Boolean((data || []).some((item) => item.name === filename));
}

export async function removeStoragePaths(bucket: string, paths: string[]) {
  const cleanPaths = paths.map((path) => path.trim()).filter(Boolean);
  if (!cleanPaths.length) return;
  await createServiceClient().storage.from(bucket).remove(cleanPaths);
}
