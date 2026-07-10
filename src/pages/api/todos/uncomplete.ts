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
    .select("id,activity_entry_id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) return json({ error: readError.message }, 500);
  if (!todo) return json({ error: "Task not found." }, 404);

  const activityError = await deleteLinkedTodoActivities(
    supabase,
    user.id,
    [id],
    todo.activity_entry_id ? [todo.activity_entry_id as string] : [],
  );
  if (activityError) return json({ error: activityError.message }, 500);

  const { data, error } = await supabase
    .from("todos")
    .update({
      completed: false,
      completed_on: null,
      completed_start_time: null,
      completed_end_time: null,
      completed_minutes: 0,
      activity_entry_id: null,
      archived_at: null,
    })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Task not found." }, 404);
  return json({ ok: true });
};
