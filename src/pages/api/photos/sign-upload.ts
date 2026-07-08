import type { APIRoute } from "astro";
import { extensionFromFile, isAllowedImageType, MAX_PHOTO_BYTES } from "../../../lib/files";
import { encryptPrivateFile } from "../../../lib/private-files";
import { ensureStorageBuckets } from "../../../lib/storage";
import { createServiceClient } from "../../../lib/supabase";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// 上传临时照片对象。文件字节先在服务端加密，再写入 Supabase Storage。
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Please choose a photo to upload." }, 400);
  }
  if (!isAllowedImageType(file.type)) {
    return json({ error: "Only image files can be uploaded." }, 400);
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

  const ext = extensionFromFile(file);
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  let encrypted: Buffer;
  try {
    encrypted = encryptPrivateFile(Buffer.from(await file.arrayBuffer()), file.type);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo encryption failed.";
    return json({ error: message }, 500);
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage.from("photos").upload(path, encrypted, {
    contentType: "application/octet-stream",
    upsert: false,
  });

  if (error) {
    return json({ error: error.message || "Could not upload photo." }, 500);
  }

  return json({ path, mime_type: file.type });
};
