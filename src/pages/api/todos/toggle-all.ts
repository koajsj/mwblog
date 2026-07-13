import type { APIRoute } from "astro";
import { createLocalsClient } from "../../../lib/local-store";
import { deleteLinkedTodoActivities, json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const store = createLocalsClient(locals);
  const { data: activeTodos, error: readError } = await store
    .from("todos")
    .select("id")
    .eq("owner_id", user.id)
    .eq("completed", false)
    .is("archived_at", null);

  if (readError) return json({ error: "Could not load the active tasks." }, 500);
  if (activeTodos?.length) {
    return json({ needsCompletion: true, ids: activeTodos.map((todo) => todo.id) });
  }

  const { data: completedTodos, error: completedReadError } = await store
    .from("todos")
    .select("id,activity_entry_id")
    .eq("owner_id", user.id)
    .eq("completed", true)
    .is("archived_at", null);

  if (completedReadError) return json({ error: "Could not load the completed tasks." }, 500);

  const todoIds = (completedTodos || []).map((todo) => todo.id).filter(Boolean);
  if (!todoIds.length) return json({ ok: true });
  const activityIds = (completedTodos || []).map((todo) => todo.activity_entry_id).filter(Boolean) as string[];
  const activityError = await deleteLinkedTodoActivities(store, user.id, todoIds, activityIds);
  if (activityError) return json({ error: "Could not reset the linked activity records." }, 500);

  const { error } = await store
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

  if (error) return json({ error: "Could not reopen the tasks." }, 500);
  return json({ ok: true });
};
