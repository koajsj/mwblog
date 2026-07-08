import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "");
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/records";
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!id) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Missing life record ID")}`, 303);
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("life_records")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error.message)}`, 303);
  }

  return redirect(`${safeReturn}${sep}deleted=record`, 303);
};
