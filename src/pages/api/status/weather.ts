import type { APIRoute } from "astro";
import { readEncryptedText } from "../../../lib/private-payload";
import { createLocalsClient } from "../../../lib/local-store";

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

  let text = "";
  try {
    text = readEncryptedText(body.text, { maxLength: 4096, context: "profile.weather" });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "invalid encrypted text" }, 400);
  }
  if (!text) return json({ ok: false, error: "empty text" }, 400);

  const store = createLocalsClient(locals);
  const { error } = await store
    .from("profiles")
    .update({
      weather_text: text,
      weather_updated_at: new Date().toISOString(),
      weather_lat: null,
      weather_lng: null,
      weather_label: null,
    })
    .eq("id", user.id);

  if (error) return json({ ok: false, error: "Could not update the weather note." }, 500);
  return json({ ok: true });
};
