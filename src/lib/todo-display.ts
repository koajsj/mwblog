import type { TodoItem } from "./types";

function shortTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "";
}

export function todoCompletionTimeLabels(todo: Pick<TodoItem, "completed_start_time" | "completed_end_time" | "completion_ranges">) {
  const linkedRanges = (todo.completion_ranges || [])
    .filter((range) => range.start_time && range.end_time)
    .map((range) => `${shortTime(range.start_time)}-${shortTime(range.end_time)}`);

  if (linkedRanges.length) return linkedRanges;

  if (todo.completed_start_time && todo.completed_end_time) {
    return [`${shortTime(todo.completed_start_time)}-${shortTime(todo.completed_end_time)}`];
  }

  return [];
}

export type TodoOutcome = "success" | "failure" | "pending";

type OutcomeInput = Pick<TodoItem, "due_on" | "completed" | "completed_on" | "updated_at">;

// 成功/失败纯派生：只对有截止日期的任务结算。
// - 已完成：completed_on <= due_on 算成功，逾期补完算失败。
// - 未完成：今天已过 due_on 算失败，否则待定。
// 无 due_on 的老任务永远待定，不进统计。日期都是 YYYY-MM-DD，可直接字典序比较。
export function todoOutcome(todo: OutcomeInput, today: string): TodoOutcome {
  if (!todo.due_on) return "pending";
  if (todo.completed) {
    if (!todo.completed_on) return "pending";
    return todo.completed_on <= todo.due_on ? "success" : "failure";
  }
  return today > todo.due_on ? "failure" : "pending";
}

// 当前连续成功次数：把已结算的任务按结算日期升序排（成功/逾期补完按 completed_on，
// 逾期未完成按 due_on，同日按 updated_at 兜底），从头累计，成功 +1、失败归 0，取末值。
export function todoWinStreak(todos: OutcomeInput[], today: string): number {
  const events = todos
    .map((todo) => ({ outcome: todoOutcome(todo, today), todo }))
    .filter((event): event is { outcome: "success" | "failure"; todo: OutcomeInput } => event.outcome !== "pending")
    .map((event) => ({
      outcome: event.outcome,
      settleOn: (event.todo.completed && event.todo.completed_on ? event.todo.completed_on : event.todo.due_on) || "",
      updatedAt: event.todo.updated_at || "",
    }))
    .sort((a, b) => a.settleOn.localeCompare(b.settleOn) || a.updatedAt.localeCompare(b.updatedAt));

  let streak = 0;
  for (const event of events) {
    streak = event.outcome === "success" ? streak + 1 : 0;
  }
  return streak;
}
