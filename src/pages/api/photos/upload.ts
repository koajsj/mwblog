import type { APIRoute } from "astro";
import { extensionFromName, MAX_PHOTO_BYTES, isAllowedImageType } from "../../../lib/files";
import { parseEncryptedFileHeader, readNullableEncryptedText } from "../../../lib/private-payload";
import { ensureStorageBuckets } from "../../../lib/storage";
import { safeLocalRedirect } from "../../../lib/redirect";
import { createLocalsClient, createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const file = form.get("photo");
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/photos");
  const sep = safeReturn.includes("?") ? "&" : "?";
  let title: string | null = null;
  let caption: string | null = null;
  try {
    title = readNullableEncryptedText(form.get("title"), { maxLength: 4096 });
    caption = readNullableEncryptedText(form.get("caption"), { maxLength: 4096 });
  } catch (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid encrypted photo text.")}`, 303);
  }
  const takenOn = String(form.get("taken_on") || "").trim() || null;

  if (!(file instanceof File) || file.size === 0) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please choose a photo to upload.")}`, 303);
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Photos must be 50 MB or smaller.")}`, 303);
  }

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  let detectedType = "";
  try {
    detectedType = parseEncryptedFileHeader(sourceBytes).mimeType;
  } catch (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid encrypted photo upload.")}`, 303);
  }
  if (!isAllowedImageType(detectedType)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Only encrypted JPEG, PNG, WebP, or GIF uploads are allowed.")}`, 303);
  }

  const supabase = createLocalsClient(locals);
  const storage = createServiceClient().storage.from("photos");
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${extensionFromName(file.name, detectedType)}`;

  try {
    await ensureStorageBuckets();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage initialization failed";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(message)}`, 303);
  }

  const { error: uploadError } = await storage.upload(path, sourceBytes, {
    contentType: "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(uploadError.message)}`, 303);
  }

  const { error: insertError } = await supabase.from("photos").insert({
    owner_id: user.id,
    title,
    caption,
    taken_on: takenOn,
    storage_path: path,
    mime_type: detectedType,
  });

  if (insertError) {
    await storage.remove([path]);
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(insertError.message)}`, 303);
  }

  return redirect(`${safeReturn}${sep}uploaded=photo`, 303);
};
