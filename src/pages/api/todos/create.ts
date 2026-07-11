import type { APIRoute } from "astro";
import { readEncryptedText } from "../../../lib/private-payload";
import { createLocalsClient } from "../../../lib/supabase";
import { json, normalizeDate } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  let title = "";
  try {
    title = readEncryptedText(form.get("title"), { maxLength: 4096 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid task content." }, 400);
  }
  if (!title) return json({ error: "Please enter a task." }, 400);

  const dueOn = normalizeDate(form.get("due_on"));
  if (!dueOn) return json({ error: "Please pick a due date (YYYY-MM-DD)." }, 400);

  const supabase = createLocalsClient(locals);
  const { error } = await supabase
    .from("todos")
    .insert({ owner_id: user.id, title, due_on: dueOn });

  if (error) return json({ error: "Could not create the task." }, 500);
  return json({ ok: true });
};
