import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "");
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/photos");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!id) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Missing photo ID")}`, 303);
  }

  const supabase = createServiceClient();
  const { data: photo, error: readError } = await supabase
    .from("photos")
    .select("id,storage_path")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(readError.message)}`, 303);
  }

  if (!photo) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Photo not found, or it does not belong to the current account")}`, 303);
  }

  const { error: deleteError } = await supabase
    .from("photos")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (deleteError) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(deleteError.message)}`, 303);
  }

  const { error: storageError } = await supabase.storage.from("photos").remove([photo.storage_path]);
  if (storageError && !/not found/i.test(storageError.message)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(storageError.message)}`, 303);
  }

  return redirect(`${safeReturn}${sep}deleted=photo`, 303);
};
