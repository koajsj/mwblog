import type { APIRoute } from "astro";
import { readEncryptedText } from "../../../lib/private-payload";
import { isUuid } from "../../../lib/security";
import { createLocalsClient } from "../../../lib/local-store";
import {
  TODO_ACTIVITY_CATEGORY,
  deleteLinkedTodoActivities,
  json,
  normalizeDate,
  normalizeTime,
  parseTimeRanges,
  periodForTime,
  isMissingTodoActivityLinkTable,
  summarizeTimeRanges,
} from "../../../lib/todo-utils";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in first." }, 401);

  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const completedOn = normalizeDate(form.get("completed_on"));
  const startTime = normalizeTime(form.get("start_time"));
  const endTime = normalizeTime(form.get("end_time"));
  const ranges = parseTimeRanges(form.get("ranges"), { start: startTime, end: endTime });
  let activityBody = "";
  try {
    activityBody = readEncryptedText(form.get("activity_body"), { maxLength: 4096, context: "activity.body" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Missing encrypted task content." }, 400);
  }
  if (!isUuid(id)) return json({ error: "Missing task id." }, 400);
  if (!completedOn || !ranges.length) return json({ error: "Please enter at least one valid completion time range." }, 400);
  if (ranges.length > 12) return json({ error: "Please keep one completion to 12 time ranges or fewer." }, 400);

  const { totalMinutes, firstStart, lastEnd } = summarizeTimeRanges(ranges);
  if (!Number.isInteger(totalMinutes) || totalMinutes < 1 || totalMinutes > 1440) {
    return json({ error: "Completion time must total between 1 minute and 24 hours." }, 400);
  }

  const store = createLocalsClient(locals);
  const { data: todo, error: readError } = await store
    .from("todos")
    .select("id,completed,activity_entry_id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (readError) return json({ error: "Could not verify the task." }, 500);
  if (!todo) return json({ error: "Task not found." }, 404);
  if (todo.completed) return json({ error: "Task is already completed." }, 409);

  const cleanupError = await deleteLinkedTodoActivities(
    store,
    user.id,
    [id],
    todo.activity_entry_id ? [todo.activity_entry_id as string] : [],
  );
  if (cleanupError) return json({ error: "Could not reset the linked activity records." }, 500);

  const activityPayloads = ranges.map((range) => ({
    owner_id: user.id,
    activity_on: completedOn,
    period: periodForTime(range.start_time),
    category: TODO_ACTIVITY_CATEGORY,
    minutes: range.minutes,
    body: activityBody,
    start_time: range.start_time,
    end_time: range.end_time,
  }));

  const { data: activities, error: activityError } = await store
    .from("activity_entries")
    .insert(activityPayloads)
    .select("id");
  if (activityError) return json({ error: "Could not create the linked activity records." }, 500);

  const activityEntryIds = (activities || []).map((activity: { id: string }) => activity.id);
  const activityEntryId = activityEntryIds[0] || null;

  if (activityEntryIds.length) {
    const { error: linkError } = await store.from("todo_activity_entries").insert(
      activityEntryIds.map((activityId: string) => ({
        todo_id: id,
        activity_entry_id: activityId,
      })),
    );
    if (linkError && !isMissingTodoActivityLinkTable(linkError)) {
      await store.from("activity_entries").delete().in("id", activityEntryIds).eq("owner_id", user.id);
      return json({ error: "Could not link the task activity records." }, 500);
    }
  }

  const { data, error } = await store
    .from("todos")
    .update({
      completed: true,
      completed_on: completedOn,
      completed_start_time: firstStart,
      completed_end_time: lastEnd,
      completed_minutes: totalMinutes,
      activity_entry_id: activityEntryId,
      archived_at: null,
    })
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("completed", false)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (activityEntryIds.length) {
      await store.from("todo_activity_entries").delete().eq("todo_id", id).in("activity_entry_id", activityEntryIds);
      await store.from("activity_entries").delete().in("id", activityEntryIds).eq("owner_id", user.id);
    }
    if (error) return json({ error: "Could not complete the task." }, 500);
    return json({ error: "Task not found." }, 404);
  }
  return json({ ok: true });
};
