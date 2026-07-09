import type { APIRoute } from "astro";
import { encryptNullablePrivateText } from "../../../lib/private-data";
import { shanghaiDateKey } from "../../../lib/datetime";
import { createServiceClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

  let body: { field?: string; value?: string } = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json" }), { status: 400 });
  }

  const field = body.field === "mood" || body.field === "doing" ? body.field : null;
  if (!field) {
    return new Response(JSON.stringify({ ok: false, error: "invalid field" }), { status: 400 });
  }

  const value = String(body.value ?? "").trim().slice(0, 80);

  const supabase = createServiceClient();
  // 空字符串 = 清空（回到默认占位）
  const payload =
    field === "mood"
      ? { mood_text: encryptNullablePrivateText(value), mood_date: value ? shanghaiDateKey() : null }
      : { doing_text: encryptNullablePrivateText(value), doing_date: value ? shanghaiDateKey() : null };

  const { error } = await supabase.from("profiles").update(payload).eq("id", user.id);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
};
