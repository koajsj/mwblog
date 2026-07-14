import type { APIRoute } from "astro";
import { createLocalsClient } from "../../../lib/local-store";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: "unauthorized" }, 401);

  const store = createLocalsClient(locals);
  const { data, error } = await store
    .from("profiles")
    .select("author_key,last_seen_at")
    .in("author_key", ["white", "brown"]);
  if (error) return json({ ok: false, error: "Could not read online status." }, 500);

  return json({ ok: true, profiles: data || [] });
};

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  const store = createLocalsClient(locals);
  const { error } = await store
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return json({ ok: false, error: "Could not update online status." }, 500);

  return json({ ok: true });
};
