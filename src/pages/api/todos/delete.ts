import type { APIRoute } from "astro";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/local-store";
import { deleteLinkedTodoActivities, json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  if (!isUuid(id)) return json({ error: "Missing task id." }, 400);

  const store = createLocalsClient(locals);
  const { data: todo, error: readError } = await store
    .from("todos")
    .select("id,completed,activity_entry_id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) return json({ error: "Could not verify the task." }, 500);
  if (!todo) return json({ error: "Task not found." }, 404);

  if (todo.completed) {
    const { data, error } = await store
      .from("todos")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", user.id)
      .eq("completed", true)
      .select("id")
      .maybeSingle();
    if (error) return json({ error: "Could not archive the task." }, 500);
    if (!data) return json({ error: "Task status changed. Please refresh and try again." }, 409);
    return json({ ok: true, archived: true });
  }

  const activityError = await deleteLinkedTodoActivities(
    store,
    user.id,
    [id],
    todo.activity_entry_id ? [todo.activity_entry_id as string] : [],
  );
  if (activityError) return json({ error: "Could not remove the linked activity records." }, 500);

  const { error } = await store.from("todos").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return json({ error: "Could not delete the task." }, 500);
  return json({ ok: true });
};
