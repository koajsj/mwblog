import type { APIRoute } from "astro";
import { createLocalsClient } from "../../../lib/supabase";
import { deleteLinkedTodoActivities, json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  if (!id) return json({ error: "Missing task id." }, 400);

  const supabase = createLocalsClient(locals);
  const { data: todo, error: readError } = await supabase
    .from("todos")
    .select("id,completed,activity_entry_id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) return json({ error: readError.message }, 500);
  if (!todo) return json({ error: "Task not found." }, 404);

  if (todo.completed) {
    const { error } = await supabase
      .from("todos")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, archived: true });
  }

  const activityError = await deleteLinkedTodoActivities(
    supabase,
    user.id,
    [id],
    todo.activity_entry_id ? [todo.activity_entry_id as string] : [],
  );
  if (activityError) return json({ error: activityError.message }, 500);

  const { error } = await supabase.from("todos").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
