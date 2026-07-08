import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase";
import { json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const title = String(form.get("title") || "").trim();
  if (!id) return json({ error: "Missing task id." }, 400);
  if (!title) return json({ error: "Please enter a task." }, 400);
  if (title.length > 120) return json({ error: "Tasks must be 120 characters or fewer." }, 400);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("todos")
    .update({ title })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id,owner_id,title,completed,completed_on,completed_start_time,completed_end_time,completed_minutes,activity_entry_id,archived_at,created_at,updated_at,profiles(display_name,author_key)")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Task not found." }, 404);
  return json({ todo: data });
};
