import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { createLocalsClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/");
  if (!id) {
    const sep = safeReturn.includes("?") ? "&" : "?";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Missing comment id.")}`, 303);
  }

  const supabase = createLocalsClient(locals);
  // 只能删自己的评论
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", id)
    .eq("author_id", user.id);

  if (error) {
    const sep = safeReturn.includes("?") ? "&" : "?";
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(safeReturn, 303);
};
