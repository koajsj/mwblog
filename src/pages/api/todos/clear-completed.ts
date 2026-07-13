import type { APIRoute } from "astro";
import { createLocalsClient } from "../../../lib/local-store";
import { json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const store = createLocalsClient(locals);
  const { data: todos, error: readError } = await store
    .from("todos")
    .select("id")
    .eq("owner_id", user.id)
    .eq("completed", true)
    .is("archived_at", null);

  if (readError) return json({ error: "Could not load the completed tasks." }, 500);

  const todoIds = (todos || []).map((todo) => todo.id).filter(Boolean);
  if (!todoIds.length) return json({ ok: true });

  const { error } = await store
    .from("todos")
    .update({ archived_at: new Date().toISOString() })
    .in("id", todoIds)
    .eq("owner_id", user.id)
    .eq("completed", true);
  if (error) return json({ error: "Could not archive the completed tasks." }, 500);
  return json({ ok: true });
};
