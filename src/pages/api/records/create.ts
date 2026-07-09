import type { APIRoute } from "astro";
import { extensionFromFile, isAllowedImageType, MAX_PHOTO_BYTES } from "../../../lib/files";
import { isDateKey } from "../../../lib/datetime";
import { encryptPrivateText } from "../../../lib/private-data";
import { encryptPrivateFile } from "../../../lib/private-files";
import { ensureStorageBuckets, removeStoragePaths, storageObjectExists } from "../../../lib/storage";
import { createServiceClient } from "../../../lib/supabase";

const validMoods = new Set(["happy", "loved", "calm", "tired", "down", "moody"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function parsePayload(request: Request, userId: string) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await request.json().catch(() => null);
    return {
      recordOn: String(payload?.record_on || "").trim(),
      mood: String(payload?.mood || "happy").trim(),
      body: String(payload?.body || "").trim(),
      photos: Array.isArray(payload?.photos) ? payload.photos : [],
      uploadedPaths: [] as string[],
    };
  }

  const form = await request.formData();
  const files = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  const uploaded: Array<{ path: string; mime_type: string }> = [];
  const uploadedPaths: string[] = [];

  for (const file of files) {
    if (!isAllowedImageType(file.type)) {
      throw new Error("Only image files can be uploaded.");
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new Error("Photos must be 50 MB or smaller.");
    }
  }

  if (files.length) {
    await ensureStorageBuckets();
  }

  const supabase = createServiceClient();
  try {
    for (const file of files) {
      const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${extensionFromFile(file)}`;
      const encrypted = encryptPrivateFile(Buffer.from(await file.arrayBuffer()), file.type);
      const { error } = await supabase.storage.from("photos").upload(path, encrypted, {
        contentType: "application/octet-stream",
        upsert: false,
      });
      if (error) throw new Error(error.message);
      uploaded.push({ path, mime_type: file.type });
      uploadedPaths.push(path);
    }
  } catch (error) {
    await removeStoragePaths("photos", uploadedPaths);
    throw error;
  }

  return {
    recordOn: String(form.get("record_on") || "").trim(),
    mood: String(form.get("mood") || "happy").trim(),
    body: String(form.get("body") || "").trim(),
    photos: uploaded,
    uploadedPaths,
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  let parsed: Awaited<ReturnType<typeof parsePayload>>;
  try {
    parsed = await parsePayload(request, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the record form.";
    return json({ error: message }, 400);
  }

  const { recordOn, mood, body, photos, uploadedPaths } = parsed;
  let validationError = "";
  if (!isDateKey(recordOn)) {
    validationError = "Please choose a life record date.";
  } else if (!body) {
    validationError = "Please write the life record body.";
  } else if (body.length > 500) {
    validationError = "Life records must be 500 characters or fewer.";
  } else if (!validMoods.has(mood)) {
    validationError = "Please choose a valid mood.";
  }

  const validPhotos: Array<{ path: string; mimeType: string }> = [];
  for (const item of photos) {
    const path = String(item?.path || "").trim();
    const mimeType = String(item?.mime_type || "").trim();
    if (!path || !path.startsWith(`${user.id}/`)) continue;
    if (mimeType && !isAllowedImageType(mimeType)) continue;
    if (!(await storageObjectExists("photos", path))) continue;
    validPhotos.push({ path, mimeType });
  }
  const supabase = createServiceClient();
  const validPhotoPaths = validPhotos.map((photo) => photo.path);
  let pendingPhotoPaths = [...uploadedPaths];
  if (validPhotoPaths.length) {
    const { data: existingPhotos, error: existingPhotosError } = await supabase
      .from("photos")
      .select("storage_path")
      .in("storage_path", validPhotoPaths);

    if (existingPhotosError) {
      return json({ error: existingPhotosError.message }, 500);
    }

    const existingPhotoPaths = new Set((existingPhotos || []).map((photo) => photo.storage_path));
    pendingPhotoPaths = validPhotoPaths.filter((path) => !existingPhotoPaths.has(path));

    if (existingPhotos?.length) {
      await removeStoragePaths("photos", pendingPhotoPaths);
      return json({ error: "One or more uploaded photos have already been saved." }, 400);
    }
  }
  if (photos.length && validPhotos.length !== photos.length) {
    await removeStoragePaths("photos", pendingPhotoPaths);
    return json({ error: "One or more uploaded photos could not be verified. Please choose them again." }, 400);
  }
  if (validationError) {
    await removeStoragePaths("photos", pendingPhotoPaths);
    return json({ error: validationError }, 400);
  }

  const { data: record, error: insertError } = await supabase
    .from("life_records")
    .insert({
      owner_id: user.id,
      record_on: recordOn,
      mood,
      body: encryptPrivateText(body),
    })
    .select("id")
    .single();

  if (insertError) {
    await removeStoragePaths("photos", pendingPhotoPaths);
    return json({ error: insertError.message }, 500);
  }

  const insertedPhotoPaths: string[] = [];
  for (const item of validPhotos) {
    const { error: photoError } = await supabase.from("photos").insert({
      owner_id: user.id,
      title: null,
      caption: encryptPrivateText(body.slice(0, 120)),
      taken_on: recordOn,
      storage_path: item.path,
      mime_type: item.mimeType || null,
    });

    if (photoError) {
      await supabase.from("photos").delete().in("storage_path", insertedPhotoPaths);
      if (record?.id) await supabase.from("life_records").delete().eq("id", record.id);
      await removeStoragePaths("photos", pendingPhotoPaths);
      return json({ error: photoError.message }, 500);
    }
    insertedPhotoPaths.push(item.path);
  }

  return json({ ok: true });
};
