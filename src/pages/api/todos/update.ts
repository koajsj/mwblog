import type { APIRoute } from "astro";
import { readEncryptedText } from "../../../lib/private-payload";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/local-store";
import { json } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  let title = "";
  try {
    title = readEncryptedText(form.get("title"), { maxLength: 4096, context: "todo.title" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid task content." }, 400);
  }
  if (!isUuid(id)) return json({ error: "Missing task id." }, 400);
  if (!title) return json({ error: "Please enter a task." }, 400);

  const store = createLocalsClient(locals);
  const { data, error } = await store
    .from("todos")
    .update({ title })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return json({ error: "Could not update the task." }, 500);
  if (!data) return json({ error: "Task not found." }, 404);
  return json({ ok: true });
};
