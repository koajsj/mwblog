import type { APIRoute } from "astro";
import { extensionFromFile, isAllowedImageType, MAX_PHOTO_BYTES } from "../../../lib/files";
import { encryptNullablePrivateText } from "../../../lib/private-data";
import { encryptPrivateFile } from "../../../lib/private-files";
import { ensureStorageBuckets } from "../../../lib/storage";
import { safeLocalRedirect } from "../../../lib/redirect";
import { isDateKey } from "../../../lib/datetime";
import { createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const file = form.get("photo");
  const title = String(form.get("title") || "").trim();
  const caption = String(form.get("caption") || "").trim();
  const takenOn = String(form.get("taken_on") || "").trim() || null;
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/photos");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!(file instanceof File) || file.size === 0) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please choose a photo to upload.")}`, 303);
  }

  if (!isAllowedImageType(file.type)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Only image files can be uploaded.")}`, 303);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Photos must be 50 MB or smaller.")}`, 303);
  }
  if (takenOn && !isDateKey(takenOn)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please choose a valid date.")}`, 303);
  }

  const supabase = createServiceClient();
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${extensionFromFile(file)}`;

  try {
    await ensureStorageBuckets();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage initialization failed";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(message)}`, 303);
  }

  let encrypted: Buffer;
  try {
    encrypted = encryptPrivateFile(Buffer.from(await file.arrayBuffer()), file.type);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo encryption failed.";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(message)}`, 303);
  }
  const { error: uploadError } = await supabase.storage.from("photos").upload(path, encrypted, {
    contentType: "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(uploadError.message)}`, 303);
  }

  const { error: insertError } = await supabase.from("photos").insert({
    owner_id: user.id,
    title: encryptNullablePrivateText(title),
    caption: encryptNullablePrivateText(caption),
    taken_on: takenOn,
    storage_path: path,
    mime_type: file.type,
  });

  if (insertError) {
    await supabase.storage.from("photos").remove([path]);
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(insertError.message)}`, 303);
  }

  return redirect(`${safeReturn}${sep}uploaded=photo`, 303);
};
