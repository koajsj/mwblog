import type { APIRoute } from "astro";
import { encryptNullablePrivateText } from "../../../lib/private-data";
import { createServiceClient } from "../../../lib/supabase";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { text?: string } = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const text = String(body.text || "").trim().slice(0, 160);
  if (!text) return json({ ok: false, error: "empty text" }, 400);

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      weather_text: encryptNullablePrivateText(text),
      weather_updated_at: new Date().toISOString(),
      weather_lat: null,
      weather_lng: null,
      weather_label: null,
    })
    .eq("id", user.id);

  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
};
