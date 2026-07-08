import type { APIRoute } from "astro";
import { decryptPrivateFields, encryptPrivateText } from "../../../lib/private-data";
import { createServiceClient } from "../../../lib/supabase";
import { json, normalizeDate } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const title = String(form.get("title") || "").trim();
  if (!title) return json({ error: "Please enter a task." }, 400);
  if (title.length > 120) return json({ error: "Tasks must be 120 characters or fewer." }, 400);

  const dueOn = normalizeDate(form.get("due_on"));
  if (!dueOn) return json({ error: "Please pick a due date (YYYY-MM-DD)." }, 400);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("todos")
    .insert({ owner_id: user.id, title: encryptPrivateText(title), due_on: dueOn })
    .select("id,owner_id,title,due_on,completed,completed_on,completed_start_time,completed_end_time,completed_minutes,activity_entry_id,archived_at,created_at,updated_at,profiles(display_name,author_key)")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ todo: data ? decryptPrivateFields(data, ["title"]) : data });
};
