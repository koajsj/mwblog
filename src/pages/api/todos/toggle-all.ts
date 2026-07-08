import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase";
import { deleteLinkedTodoActivities, json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const supabase = createServiceClient();
  const { data: activeTodos, error: readError } = await supabase
    .from("todos")
    .select("id")
    .eq("owner_id", user.id)
    .eq("completed", false)
    .is("archived_at", null);

  if (readError) return json({ error: readError.message }, 500);
  if (activeTodos?.length) {
    return json({ needsCompletion: true, ids: activeTodos.map((todo) => todo.id) });
  }

  const { data: completedTodos, error: completedReadError } = await supabase
    .from("todos")
    .select("id,activity_entry_id")
    .eq("owner_id", user.id)
    .eq("completed", true)
    .is("archived_at", null);

  if (completedReadError) return json({ error: completedReadError.message }, 500);

  const todoIds = (completedTodos || []).map((todo) => todo.id).filter(Boolean);
  const activityIds = (completedTodos || []).map((todo) => todo.activity_entry_id).filter(Boolean) as string[];
  const activityError = await deleteLinkedTodoActivities(supabase, user.id, todoIds, activityIds);
  if (activityError) return json({ error: activityError.message }, 500);

  const { error } = await supabase
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
    .eq("owner_id", user.id)
    .in("id", todoIds);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
