import type { APIRoute } from "astro";
import { extensionFromName, MAX_PHOTO_BYTES, isAllowedImageType } from "../../../lib/files";
import { parseEncryptedFileHeader } from "../../../lib/private-payload";
import { ensureStorageBuckets } from "../../../lib/storage";
import { createServiceClient } from "../../../lib/local-store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// 上传临时照片对象。文件字节必须已由浏览器端加密，再由服务端受控写入 Storage。
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Please choose a photo to upload." }, 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return json({ error: "Photos must be 50 MB or smaller." }, 400);
  }

  try {
    await ensureStorageBuckets();
  } catch {
    return json({ error: "Photo storage is temporarily unavailable." }, 500);
  }

  const headerBytes = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  let detectedType = "";
  try {
    const encryptedFile = parseEncryptedFileHeader(headerBytes);
    if (!encryptedFile.current) throw new Error("Photo must use the current client-encryption format.");
    detectedType = encryptedFile.mimeType;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid encrypted photo upload." }, 400);
  }
  if (!isAllowedImageType(detectedType)) return json({ error: "Only encrypted JPEG, PNG, WebP, or GIF uploads are allowed." }, 400);

  const ext = extensionFromName(file.name, detectedType);
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const storage = createServiceClient().storage.from("photos");
  const { error } = await storage.upload(path, file, {
    contentType: "application/octet-stream",
    upsert: false,
  });

  if (error) return json({ error: "Could not upload the encrypted photo." }, 500);

  return json({ path, mime_type: detectedType });
};
