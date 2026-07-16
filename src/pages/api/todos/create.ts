import type { APIRoute } from "astro";
import { readEncryptedText } from "../../../lib/private-payload";
import { createLocalsClient } from "../../../lib/local-store";
import { json, normalizeDate } from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const clearDraft = String(form.get("draft_key") || "").trim() === "todo-create";
  let title = "";
  try {
    title = readEncryptedText(form.get("title"), { maxLength: 4096, context: "todo.title" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid task content." }, 400);
  }
  if (!title) return json({ error: "Please enter a task." }, 400);

  const dueOn = normalizeDate(form.get("due_on"));
  if (!dueOn) return json({ error: "Please pick a due date (YYYY-MM-DD)." }, 400);

  const store = createLocalsClient(locals);
  const { error } = await store
    .from("todos")
    .insert({ owner_id: user.id, title, due_on: dueOn });

  if (error) return json({ error: "Could not create the task." }, 500);
  if (clearDraft) {
    await store.from("private_drafts").delete().eq("owner_id", user.id).eq("draft_key", "todo-create");
  }
  return json({ ok: true });
};
