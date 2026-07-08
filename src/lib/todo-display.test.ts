import assert from "node:assert/strict";
import test from "node:test";
import { todoCompletionTimeLabels, todoOutcome, todoWinStreak } from "./todo-display.ts";
import type { TodoItem } from "./types";

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "todo-1",
    owner_id: "user-1",
    title: "Practice",
    due_on: null,
    completed: true,
    completed_on: "2026-05-28",
    completed_start_time: "09:00",
    completed_end_time: "20:00",
    completed_minutes: 180,
    activity_entry_id: "activity-1",
    archived_at: null,
    created_at: "2026-05-28T00:00:00Z",
    updated_at: "2026-05-28T00:00:00Z",
    ...overrides,
  };
}

test("formats every completion time range when a todo has multiple linked activity entries", () => {
  assert.deepEqual(
    todoCompletionTimeLabels(todo({
      completion_ranges: [
        { start_time: "09:00", end_time: "10:00", minutes: 60 },
        { start_time: "19:30", end_time: "21:00", minutes: 90 },
      ],
    })),
    ["09:00-10:00", "19:30-21:00"],
  );
});

test("falls back to the legacy summary range when linked ranges are not available", () => {
  assert.deepEqual(todoCompletionTimeLabels(todo()), ["09:00-20:00"]);
});

test("todoOutcome: a task without a due date is always pending", () => {
  assert.equal(todoOutcome(todo({ due_on: null, completed: false, completed_on: null }), "2026-05-31"), "pending");
  assert.equal(todoOutcome(todo({ due_on: null, completed: true, completed_on: "2026-05-28" }), "2026-05-31"), "pending");
});

test("todoOutcome: completed on or before the due date is a success", () => {
  assert.equal(todoOutcome(todo({ due_on: "2026-05-30", completed: true, completed_on: "2026-05-28" }), "2026-05-31"), "success");
  assert.equal(todoOutcome(todo({ due_on: "2026-05-30", completed: true, completed_on: "2026-05-30" }), "2026-05-31"), "success");
});

test("todoOutcome: completed after the due date is a failure", () => {
  assert.equal(todoOutcome(todo({ due_on: "2026-05-28", completed: true, completed_on: "2026-05-30" }), "2026-05-31"), "failure");
});

test("todoOutcome: incomplete past the due date is a failure", () => {
  assert.equal(todoOutcome(todo({ due_on: "2026-05-30", completed: false, completed_on: null }), "2026-05-31"), "failure");
});

test("todoOutcome: incomplete but still within the due date is pending", () => {
  assert.equal(todoOutcome(todo({ due_on: "2026-05-31", completed: false, completed_on: null }), "2026-05-31"), "pending");
  assert.equal(todoOutcome(todo({ due_on: "2026-06-02", completed: false, completed_on: null }), "2026-05-31"), "pending");
});

test("todoWinStreak: counts the trailing run of successes ordered by settle date", () => {
  const todos = [
    todo({ id: "a", due_on: "2026-05-20", completed: true, completed_on: "2026-05-19" }),
    todo({ id: "b", due_on: "2026-05-22", completed: true, completed_on: "2026-05-21" }),
    todo({ id: "c", due_on: "2026-05-24", completed: true, completed_on: "2026-05-23" }),
  ];
  assert.equal(todoWinStreak(todos, "2026-05-31"), 3);
});

test("todoWinStreak: a failure resets the running count to zero", () => {
  const todos = [
    todo({ id: "a", due_on: "2026-05-20", completed: true, completed_on: "2026-05-19" }),
    todo({ id: "b", due_on: "2026-05-22", completed: false, completed_on: null }), // overdue failure
    todo({ id: "c", due_on: "2026-05-24", completed: true, completed_on: "2026-05-23" }),
    todo({ id: "d", due_on: "2026-05-26", completed: true, completed_on: "2026-05-25" }),
  ];
  assert.equal(todoWinStreak(todos, "2026-05-31"), 2);
});

test("todoWinStreak: a trailing failure yields zero", () => {
  const todos = [
    todo({ id: "a", due_on: "2026-05-20", completed: true, completed_on: "2026-05-19" }),
    todo({ id: "b", due_on: "2026-05-22", completed: false, completed_on: null }),
  ];
  assert.equal(todoWinStreak(todos, "2026-05-31"), 0);
});

test("todoWinStreak: orders by settle date, not array order", () => {
  const todos = [
    todo({ id: "later", due_on: "2026-05-26", completed: true, completed_on: "2026-05-25" }),
    todo({ id: "fail-mid", due_on: "2026-05-22", completed: false, completed_on: null }),
    todo({ id: "early", due_on: "2026-05-20", completed: true, completed_on: "2026-05-19" }),
  ];
  // timeline: early(success) -> fail-mid(failure) -> later(success) => streak 1
  assert.equal(todoWinStreak(todos, "2026-05-31"), 1);
});

test("todoWinStreak: pending and no-due-date tasks do not affect the streak", () => {
  const todos = [
    todo({ id: "a", due_on: "2026-05-20", completed: true, completed_on: "2026-05-19" }),
    todo({ id: "pending", due_on: "2026-06-10", completed: false, completed_on: null }),
    todo({ id: "legacy", due_on: null, completed: true, completed_on: "2026-05-29" }),
    todo({ id: "b", due_on: "2026-05-24", completed: true, completed_on: "2026-05-23" }),
  ];
  assert.equal(todoWinStreak(todos, "2026-05-31"), 2);
});

test("todoWinStreak: late completion counts as a failure and breaks the streak", () => {
  const todos = [
    todo({ id: "a", due_on: "2026-05-20", completed: true, completed_on: "2026-05-19" }),
    todo({ id: "late", due_on: "2026-05-22", completed: true, completed_on: "2026-05-25" }),
  ];
  // late settles at completed_on 2026-05-25, after a's 2026-05-19 => trailing failure => 0
  assert.equal(todoWinStreak(todos, "2026-05-31"), 0);
});

test("todoWinStreak: empty list is zero", () => {
  assert.equal(todoWinStreak([], "2026-05-31"), 0);
});
