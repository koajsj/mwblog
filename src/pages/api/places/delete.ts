import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/places");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!isUuid(id)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Missing place ID.")}`, 303);
  }

  const supabase = createLocalsClient(locals);
  const { error } = await supabase
    .from("places")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not delete the place.")}`, 303);
  }

  return redirect(`${safeReturn}${sep}deleted=place`, 303);
};
