import type { APIRoute } from "astro";
import { isOwnedStoragePath } from "../../../lib/files";
import { safeLocalRedirect } from "../../../lib/redirect";
import { isUuid } from "../../../lib/security";
import { createLocalsClient, createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "");
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/photos");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!isUuid(id)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Missing photo ID")}`, 303);
  }

  const supabase = createLocalsClient(locals);
  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("id,storage_path")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not verify the photo.")}`, 303);
  }

  if (!photo) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Photo not found, or it does not belong to the current account")}`, 303);
  }

  if (isOwnedStoragePath(photo.storage_path, user.id)) {
    const { error: storageError } = await createServiceClient().storage.from("photos").remove([photo.storage_path]);
    if (storageError && !/not found/i.test(storageError.message)) {
      return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not remove the encrypted photo file.")}`, 303);
    }
  }

  const { error: deleteError } = await supabase
    .from("photos")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (deleteError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not delete the photo.")}`, 303);
  }

  return redirect(`${safeReturn}${sep}deleted=photo`, 303);
};
