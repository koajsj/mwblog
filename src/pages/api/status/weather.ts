import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

  let body: { text?: string; lat?: number; lng?: number; label?: string } = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json" }), { status: 400 });
  }
  const text = String(body.text || "").trim().slice(0, 160);
  if (!text) {
    return new Response(JSON.stringify({ ok: false, error: "empty text" }), { status: 400 });
  }

  const update: Record<string, unknown> = {
    weather_text: text,
    weather_updated_at: new Date().toISOString(),
  };
  // 坐标可选；提供了就一起持久化，让对方设备能用这些坐标拉实时天气
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    update.weather_lat = lat;
    update.weather_lng = lng;
  }
  const label = String(body.label || "").trim().slice(0, 80);
  if (label) update.weather_label = label;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
};
