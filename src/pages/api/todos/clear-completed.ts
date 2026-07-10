import type { APIRoute } from "astro";
import { createLocalsClient } from "../../../lib/supabase";
import { json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const supabase = createLocalsClient(locals);
  const { data: todos, error: readError } = await supabase
    .from("todos")
    .select("id")
    .eq("owner_id", user.id)
    .eq("completed", true)
    .is("archived_at", null);

  if (readError) return json({ error: readError.message }, 500);

  const todoIds = (todos || []).map((todo) => todo.id).filter(Boolean);
  if (!todoIds.length) return json({ ok: true });

  const { error } = await supabase
    .from("todos")
    .update({ archived_at: new Date().toISOString() })
    .in("id", todoIds)
    .eq("owner_id", user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
