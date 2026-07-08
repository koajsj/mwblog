import type { APIRoute } from "astro";
import { decryptPrivateRows } from "../../../lib/private-data";
import { createServiceClient } from "../../../lib/supabase";
import { isMissingTodoActivityLinkTable, json } from "../../../lib/todo-utils";
import type { AuthorKey, TodoCompletionRange, TodoItem } from "../../../lib/types";

export const GET: APIRoute = async ({ url, locals }) => {
  const view = (url.searchParams.get("view") === "brown" ? "brown" : "white") as AuthorKey;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("todos")
    .select("id,owner_id,title,due_on,completed,completed_on,completed_start_time,completed_end_time,completed_minutes,activity_entry_id,archived_at,created_at,updated_at,profiles(display_name,author_key)")
    .order("created_at", { ascending: true });

  if (error) return json({ error: error.message }, 500);

  const todos = decryptPrivateRows((data || []) as TodoItem[], ["title"]).filter((todo) => (todo.profiles?.author_key || "white") === view);
  const todoIds = todos.map((todo) => todo.id);

  if (todoIds.length) {
    const { data: links, error: linkError } = await supabase
      .from("todo_activity_entries")
      .select("todo_id,activity_entries(start_time,end_time,minutes)")
      .in("todo_id", todoIds);

    if (linkError && !isMissingTodoActivityLinkTable(linkError)) {
      return json({ error: linkError.message }, 500);
    }

    if (!linkError) {
      const rangesByTodo = new Map<string, TodoCompletionRange[]>();
      (links || []).forEach((link: any) => {
        const activity = Array.isArray(link.activity_entries) ? link.activity_entries[0] : link.activity_entries;
        if (!activity) return;
        const ranges = rangesByTodo.get(link.todo_id) || [];
        ranges.push({
          start_time: activity.start_time || null,
          end_time: activity.end_time || null,
          minutes: activity.minutes ?? null,
        });
        rangesByTodo.set(link.todo_id, ranges);
      });

      todos.forEach((todo) => {
        todo.completion_ranges = (rangesByTodo.get(todo.id) || []).sort((a, b) => {
          const left = `${a.start_time || ""}-${a.end_time || ""}`;
          const right = `${b.start_time || ""}-${b.end_time || ""}`;
          return left.localeCompare(right);
        });
      });
    }
  }

  return json({
    todos,
    userId: locals.user?.id || null,
    profile: locals.profile || null,
    canEdit: Boolean(locals.user && locals.profile?.author_key === view),
  });
};
