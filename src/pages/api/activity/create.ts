import type { APIRoute } from "astro";
import { ACTIVITY_CATEGORIES } from "../../../lib/types";
import { safeLocalRedirect } from "../../../lib/redirect";
import { encryptPrivateText } from "../../../lib/private-data";
import { createServiceClient } from "../../../lib/supabase";

const fallbackCategory = ACTIVITY_CATEGORIES[ACTIVITY_CATEGORIES.length - 1];

function normalizeTime(value: FormDataEntryValue | null) {
  const raw = String(value || "").trim();
  const hit = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!hit) return null;
  const hours = Number(hit[1]);
  const minutes = Number(hit[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function minutesOfClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function durationMinutes(startTime: string, endTime: string) {
  const start = minutesOfClock(startTime);
  const end = minutesOfClock(endTime);
  return end > start ? end - start : end + 1440 - start;
}

function periodForTime(startTime: string) {
  const minutes = minutesOfClock(startTime);
  if (minutes >= 5 * 60 && minutes < 8 * 60) return "morning";
  if (minutes >= 8 * 60 && minutes < 11 * 60) return "forenoon";
  if (minutes >= 11 * 60 && minutes < 14 * 60) return "noon";
  if (minutes >= 14 * 60 && minutes < 17 * 60) return "afternoon";
  if (minutes >= 17 * 60 && minutes < 19 * 60) return "dusk";
  if (minutes >= 19 * 60 && minutes < 23 * 60) return "evening";
  return "midnight";
}

function withError(path: string, message: string) {
  return `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`;
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect("/auth/login", 303);

  const form = await request.formData();
  const activityOn = String(form.get("activity_on") || "").trim();
  const body = String(form.get("body") || "").trim();
  const startTime = normalizeTime(form.get("start_time"));
  const endTime = normalizeTime(form.get("end_time"));
  const returnTo = String(form.get("return_to") || "/activity");
  const failTo = safeLocalRedirect(returnTo, "/activity");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityOn)) {
    return redirect(withError(failTo, "Please choose an activity date."), 303);
  }

  if (!body) {
    return redirect(withError(failTo, "Please enter a task name."), 303);
  }

  if (body.length > 80) {
    return redirect(withError(failTo, "Task names must be 80 characters or fewer."), 303);
  }

  if (!startTime || !endTime) {
    return redirect(withError(failTo, "Please choose a valid start and end time."), 303);
  }

  const minutes = durationMinutes(startTime, endTime);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return redirect(withError(failTo, "End time must be after start time. Overnight tasks are supported."), 303);
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("activity_entries").insert({
    owner_id: user.id,
    activity_on: activityOn,
    period: periodForTime(startTime),
    category: fallbackCategory,
    minutes,
    body: encryptPrivateText(body),
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    return redirect(withError(failTo, error.message), 303);
  }

  return redirect(`${failTo}${failTo.includes("?") ? "&" : "?"}created=activity`, 303);
};
