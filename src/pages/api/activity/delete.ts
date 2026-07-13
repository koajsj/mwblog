import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/local-store";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const id = String(form.get("id") || "");
  const returnTo = String(form.get("return_to") || "/activity");
  const failTo = safeLocalRedirect(returnTo, "/activity");
  if (!isUuid(id)) {
    return redirect(`${failTo}${failTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("Missing activity record ID.")}`, 303);
  }

  const store = createLocalsClient(locals);
  const { error } = await store
    .from("activity_entries")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) {
    return redirect(`${failTo}${failTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("Could not delete the activity record.")}`, 303);
  }

  return redirect(`${failTo}${failTo.includes("?") ? "&" : "?"}deleted=activity`, 303);
};
