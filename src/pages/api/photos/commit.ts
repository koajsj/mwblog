import type { APIRoute } from "astro";
import { isIsoCalendarDate } from "../../../lib/datetime";
import { createLocalsClient } from "../../../lib/supabase";
import { isAllowedImageType, isOwnedStoragePath } from "../../../lib/files";
import { readNullableEncryptedText } from "../../../lib/private-payload";
import { removeStoragePaths, storageObjectExists } from "../../../lib/storage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// 图片已经直传到 Storage 后，由这里把对应的 photos 行写入数据库。
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const payload = await request.json().catch(() => null);
  const path = String(payload?.path || "").trim();
  const mimeType = String(payload?.mime_type || "").trim();
  let title: string | null = null;
  let caption: string | null = null;
  try {
    title = readNullableEncryptedText(payload?.title, { maxLength: 4096 });
    caption = readNullableEncryptedText(payload?.caption, { maxLength: 4096 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid encrypted photo text." }, 400);
  }
  const takenOn = String(payload?.taken_on || "").trim() || null;

  // 只允许写入自己目录下、且确实由本次会话上传的路径。
  if (!isOwnedStoragePath(path, user.id)) {
    return json({ error: "Invalid upload path." }, 400);
  }
  if (!isAllowedImageType(mimeType)) {
    return json({ error: "Only image files can be uploaded." }, 400);
  }
  if (takenOn && !isIsoCalendarDate(takenOn)) {
    return json({ error: "Please choose a valid date." }, 400);
  }
  const supabase = createLocalsClient(locals);
  if (!(await storageObjectExists(supabase, "photos", path))) {
    return json({ error: "Uploaded photo was not found. Please choose it again." }, 400);
  }

  const { error: insertError } = await supabase.from("photos").insert({
    owner_id: user.id,
    title,
    caption,
    taken_on: takenOn,
    storage_path: path,
    mime_type: mimeType || null,
  });

  if (insertError) {
    await removeStoragePaths(supabase, "photos", [path]);
    return json({ error: "Could not save the photo." }, 500);
  }

  return json({ ok: true });
};
