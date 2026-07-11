import type { APIRoute } from "astro";
import { safeLocalRedirect } from "../../../lib/redirect";
import { readEncryptedText } from "../../../lib/private-payload";
import { createLocalsClient } from "../../../lib/supabase";

const validTones = new Set(["night", "desert", "forest", "sea"]);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const tone = String(form.get("tone") || "night").trim();
  const rawReturn = String(form.get("return_to") || "").trim();
  const safeReturn = safeLocalRedirect(rawReturn, "/places");
  const sep = safeReturn.includes("?") ? "&" : "?";
  let name = "";
  let note = "";
  try {
    name = readEncryptedText(form.get("name"), { maxLength: 4096, context: "place.name" });
    note = readEncryptedText(form.get("note"), { maxLength: 4096, context: "place.note" });
  } catch (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid encrypted place content.")}`, 303);
  }

  if (!name) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please enter a place name between 1 and 32 characters.")}`, 303);
  }

  if (!note) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please enter a reason between 1 and 140 characters.")}`, 303);
  }

  if (!validTones.has(tone)) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Please choose a valid vibe.")}`, 303);
  }

  const supabase = createLocalsClient(locals);
  const { error } = await supabase.from("places").insert({
    owner_id: user.id,
    name,
    note,
    tone,
  });

  if (error) {
    return redirect(`${safeReturn}${sep}error=${encodeURIComponent("Could not save the place.")}`, 303);
  }

  return redirect(`${safeReturn}${sep}created=place`, 303);
};
