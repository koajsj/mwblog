import type { APIRoute } from "astro";
import { isAllowedImageType } from "../../../lib/files";
import { readEncryptedText } from "../../../lib/private-payload";
import { removeStoragePaths, storageObjectExists } from "../../../lib/storage";
import { createLocalsClient } from "../../../lib/supabase";

const validMoods = new Set(["happy", "loved", "calm", "tired", "down", "moody"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const payload = await request.json().catch(() => null);
  const recordOn = String(payload?.record_on || "").trim();
  const mood = String(payload?.mood || "happy").trim();
  let body = "";
  let photoCaption = "";
  try {
    body = readEncryptedText(payload?.body, { maxLength: 8192 });
    photoCaption = readEncryptedText(payload?.photo_caption, { maxLength: 4096 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid encrypted record content." }, 400);
  }
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordOn)) {
    return json({ error: "Please choose a life record date." }, 400);
  }
  if (!body) {
    return json({ error: "Please write the life record body." }, 400);
  }
  if (!validMoods.has(mood)) {
    return json({ error: "Please choose a valid mood." }, 400);
  }

  const supabase = createLocalsClient(locals);
  const validPhotos: Array<{ path: string; mimeType: string }> = [];
  for (const item of photos) {
    const path = String(item?.path || "").trim();
    const mimeType = String(item?.mime_type || "").trim();
    if (!path || !path.startsWith(`${user.id}/`)) continue;
    if (mimeType && !isAllowedImageType(mimeType)) continue;
    if (!(await storageObjectExists(supabase, "photos", path))) continue;
    validPhotos.push({ path, mimeType });
  }
  if (photos.length && validPhotos.length !== photos.length) {
    await removeStoragePaths(supabase, "photos", validPhotos.map((photo) => photo.path));
    return json({ error: "One or more uploaded photos could not be verified. Please choose them again." }, 400);
  }

  const { data: record, error: insertError } = await supabase
    .from("life_records")
    .insert({
      owner_id: user.id,
      record_on: recordOn,
      mood,
      body,
    })
    .select("id")
    .single();

  if (insertError) {
    await removeStoragePaths(supabase, "photos", validPhotos.map((photo) => photo.path));
    return json({ error: insertError.message }, 500);
  }

  const insertedPhotoPaths: string[] = [];
  for (const item of validPhotos) {
    const { error: photoError } = await supabase.from("photos").insert({
      owner_id: user.id,
      title: null,
      caption: photoCaption,
      taken_on: recordOn,
      storage_path: item.path,
      mime_type: item.mimeType || null,
    });

    if (photoError) {
      await supabase.from("photos").delete().in("storage_path", insertedPhotoPaths);
      if (record?.id) await supabase.from("life_records").delete().eq("id", record.id);
      await removeStoragePaths(supabase, "photos", validPhotos.map((photo) => photo.path));
      return json({ error: photoError.message }, 500);
    }
    insertedPhotoPaths.push(item.path);
  }

  return json({ ok: true });
};
