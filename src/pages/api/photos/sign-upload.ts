import type { APIRoute } from "astro";
import { extensionFromName, isAllowedImageType, MAX_PHOTO_BYTES } from "../../../lib/files";
import { ensureStorageBuckets } from "../../../lib/storage";
import { createServiceClient } from "../../../lib/supabase";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// 生成一个针对单张图片的签名上传地址。图片字节由浏览器直传到 Supabase，
// 不经过本函数，从而绕开 Vercel 4.5MB 请求体限制。
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const payload = await request.json().catch(() => null);
  const filename = String(payload?.filename || "").trim();
  const contentType = String(payload?.contentType || "").trim();
  const size = Number(payload?.size || 0);

  if (!isAllowedImageType(contentType)) {
    return json({ error: "Only image files can be uploaded." }, 400);
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) {
    return json({ error: "Photos must be 50 MB or smaller." }, 400);
  }

  try {
    await ensureStorageBuckets();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage initialization failed";
    return json({ error: message }, 500);
  }

  const ext = extensionFromName(filename, contentType);
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from("photos").createSignedUploadUrl(path);

  if (error || !data) {
    return json({ error: error?.message || "Could not create upload URL." }, 500);
  }

  return json({ path: data.path, token: data.token });
};
