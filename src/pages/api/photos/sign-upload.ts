import type { APIRoute } from "astro";
import { extensionFromName, MAX_PHOTO_BYTES, isAllowedImageType } from "../../../lib/files";
import { parseEncryptedFileHeader } from "../../../lib/private-payload";
import { ensureStorageBuckets } from "../../../lib/storage";
import { createServiceClient } from "../../../lib/supabase";

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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage initialization failed";
    return json({ error: message }, 500);
  }

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  let detectedType = "";
  try {
    detectedType = parseEncryptedFileHeader(sourceBytes).mimeType;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid encrypted photo upload." }, 400);
  }
  if (!isAllowedImageType(detectedType)) return json({ error: "Only encrypted JPEG, PNG, WebP, or GIF uploads are allowed." }, 400);

  const ext = extensionFromName(file.name, detectedType);
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const storage = createServiceClient().storage.from("photos");
  const { error } = await storage.upload(path, sourceBytes, {
    contentType: "application/octet-stream",
    upsert: false,
  });

  if (error) {
    return json({ error: error.message || "Could not upload photo." }, 500);
  }

  return json({ path, mime_type: detectedType });
};
