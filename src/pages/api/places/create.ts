import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { encryptPrivateText } from "../../../lib/private-data";
import { createServiceClient } from "../../../lib/supabase";

const validTones = new Set(["night", "desert", "forest", "sea"]);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const note = String(form.get("note") || "").trim();
  const tone = String(form.get("tone") || "night").trim();
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/places");
  const sep = safeReturn.includes("?") ? "&" : "?";

  if (!name || name.length > 32) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please enter a place name between 1 and 32 characters.")}`, 303);
  }

  if (!note || note.length > 140) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please enter a reason between 1 and 140 characters.")}`, 303);
  }

  if (!validTones.has(tone)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please choose a valid vibe.")}`, 303);
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("places").insert({
    owner_id: user.id,
    name: encryptPrivateText(name),
    note: encryptPrivateText(note),
    tone,
  });

  if (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error.message)}`, 303);
  }

  return redirect(`${safeReturn}${sep}created=place`, 303);
};
