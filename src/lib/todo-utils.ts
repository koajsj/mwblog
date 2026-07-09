import { ACTIVITY_CATEGORIES } from "./types";
import { isDateKey } from "./datetime";

export const TODO_ACTIVITY_CATEGORY = ACTIVITY_CATEGORIES[ACTIVITY_CATEGORIES.length - 1];

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function normalizeDate(value: FormDataEntryValue | string | null) {
  const raw = String(value || "").trim();
  return isDateKey(raw) ? raw : null;
}

export function normalizeTime(value: FormDataEntryValue | string | null) {
  const raw = String(value || "").trim();
  const hit = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!hit) return null;
  const hours = Number(hit[1]);
  const minutes = Number(hit[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function minutesOfClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function durationMinutes(startTime: string, endTime: string) {
  const start = minutesOfClock(startTime);
  const end = minutesOfClock(endTime);
  return end > start ? end - start : end + 1440 - start;
}

export function periodForTime(startTime: string) {
  const minutes = minutesOfClock(startTime);
  if (minutes >= 5 * 60 && minutes < 8 * 60) return "morning";
  if (minutes >= 8 * 60 && minutes < 11 * 60) return "forenoon";
  if (minutes >= 11 * 60 && minutes < 14 * 60) return "noon";
  if (minutes >= 14 * 60 && minutes < 17 * 60) return "afternoon";
  if (minutes >= 17 * 60 && minutes < 19 * 60) return "dusk";
  if (minutes >= 19 * 60 && minutes < 23 * 60) return "evening";
  return "midnight";
}

export interface TimeRange {
  start_time: string;
  end_time: string;
  minutes: number;
}

export function parseTimeRanges(raw: FormDataEntryValue | string | null, fallback?: { start: string | null; end: string | null }) {
  const ranges: TimeRange[] = [];
  const source = String(raw || "").trim();

  if (source) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const start = normalizeTime(item?.start_time ?? item?.start);
          const end = normalizeTime(item?.end_time ?? item?.end);
          if (!start || !end) return;
          const minutes = durationMinutes(start, end);
          if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) {
            ranges.push({ start_time: start, end_time: end, minutes });
          }
        });
      }
    } catch {
      // Ignore malformed JSON and let the caller return a validation error.
    }
  }

  if (!ranges.length && fallback?.start && fallback?.end) {
    const minutes = durationMinutes(fallback.start, fallback.end);
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) {
      ranges.push({ start_time: fallback.start, end_time: fallback.end, minutes });
    }
  }

  return ranges;
}

export function summarizeTimeRanges(ranges: TimeRange[]) {
  const totalMinutes = ranges.reduce((sum, range) => sum + range.minutes, 0);
  return {
    totalMinutes,
    firstStart: ranges[0]?.start_time || null,
    lastEnd: ranges[ranges.length - 1]?.end_time || null,
  };
}

export function isMissingTodoActivityLinkTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01" || /todo_activity_entries|relation .* does not exist/i.test(error.message || "");
}

export async function deleteLinkedTodoActivities(
  supabase: any,
  userId: string,
  todoIds: string[],
  legacyActivityIds: string[] = [],
) {
  const ids = Array.from(new Set(todoIds.filter(Boolean)));
  const activityIds = new Set(legacyActivityIds.filter(Boolean));

  if (ids.length) {
    const { data, error } = await supabase
      .from("todo_activity_entries")
      .select("activity_entry_id")
      .in("todo_id", ids);
    if (error) {
      if (!isMissingTodoActivityLinkTable(error)) return error;
    } else {
      (data || []).forEach((row: { activity_entry_id?: string | null }) => {
        if (row.activity_entry_id) activityIds.add(row.activity_entry_id);
      });

      const { error: linkError } = await supabase
        .from("todo_activity_entries")
        .delete()
        .in("todo_id", ids);
      if (linkError && !isMissingTodoActivityLinkTable(linkError)) return linkError;
    }
  }

  const deleteIds = Array.from(activityIds);
  if (deleteIds.length) {
    const { error } = await supabase
      .from("activity_entries")
      .delete()
      .in("id", deleteIds)
      .eq("owner_id", userId);
    if (error) return error;
  }

  return null;
}
