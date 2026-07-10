import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { todoCompletionTimeLabels, todoOutcome, todoWinStreak } from "../lib/todo-display";
import type { AuthorKey, Profile, TodoItem } from "../lib/types";

type Filter = "all" | "active" | "completed";

interface CompletionRange {
  id: string;
  start: string;
  end: string;
}

interface Props {
  initialView: AuthorKey;
  authorNames: Record<AuthorKey, string>;
  currentAuthor: AuthorKey | null;
  profile: Profile | null;
}

interface ApiState {
  todos: TodoItem[];
  canEdit: boolean;
}

function privateSpaceApi() {
  return (window as any).OurNestPrivate || null;
}

async function encryptPrivateTextValue(value: string) {
  const api = privateSpaceApi();
  if (!api?.encryptText) {
    throw new Error("Private-space encryption is not ready.");
  }
  return api.encryptText(value);
}

async function decryptTodoRows(rows: TodoItem[]) {
  const api = privateSpaceApi();
  if (!api?.decryptText) return rows;
  return Promise.all(rows.map(async (todo) => ({
    ...todo,
    title: await api.decryptText(todo.title),
  })));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

// 把当天完成的总分钟数映射到 0-8 的色阶。阈值按真实的一天铺开，
// 让短时长的一天也能呈现浅色，而不是动辄就到最深。
const HEAT_THRESHOLDS = [30, 60, 120, 180, 240, 360, 480];
function heatLevel(minutes: number) {
  if (minutes <= 0) return 0;
  let level = 1;
  for (const threshold of HEAT_THRESHOLDS) {
    if (minutes < threshold) break;
    level += 1;
  }
  return level;
}

function fmtMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hr${hours > 1 ? "s" : ""}${rest ? ` ${rest} min` : ""}`;
}

function newRange(start = "09:00", end = "10:00"): CompletionRange {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, start, end };
}

function normalizeClock(value: string) {
  const hit = value.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!hit) return value.trim();
  const hours = Number(hit[1]);
  const minutes = Number(hit[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return value.trim();
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isClock(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutesOfClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function rangeMinutes(range: CompletionRange) {
  if (!isClock(range.start) || !isClock(range.end)) return 0;
  const start = minutesOfClock(range.start);
  const end = minutesOfClock(range.end);
  return end > start ? end - start : end + 1440 - start;
}

function addClockMinutes(value: string, amount: number) {
  if (!isClock(value)) return "10:00";
  const total = (minutesOfClock(value) + amount) % 1440;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function postForm(path: string, fields: Record<string, string>) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.set(key, value));
  return fetch(path, { method: "POST", body: form }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function sumMinutes(todos: TodoItem[]) {
  return todos.reduce((sum, todo) => sum + Number(todo.completed_minutes || 0), 0);
}

function isArchived(todo: TodoItem) {
  return Boolean(todo.archived_at);
}

function streakDays(minutesByDay: Map<string, number>) {
  let streak = 0;
  let day = new Date();
  while (minutesByDay.get(dateKey(day))) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

export default function TodoApp({ initialView, authorNames, currentAuthor, profile }: Props) {
  const [view, setView] = useState<AuthorKey>(initialView);
  const [filter, setFilter] = useState<Filter>("all");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState(todayKey());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [completionMessage, setCompletionMessage] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionIds, setCompletionIds] = useState<string[]>([]);
  const [completionDate, setCompletionDate] = useState(todayKey());
  const [completionRanges, setCompletionRanges] = useState<CompletionRange[]>(() => [newRange()]);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const loadRequestRef = useRef(0);

  const selectedName = authorNames[view];
  const listTodos = todos.filter((todo) => !isArchived(todo));
  const activeTodos = listTodos.filter((todo) => !todo.completed);
  const completedTodos = todos.filter((todo) => todo.completed);
  const listCompletedTodos = listTodos.filter((todo) => todo.completed);
  const doneToday = completedTodos.filter((todo) => todo.completed_on === todayKey());
  const visibleTodos = listTodos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });
  const todayTotalCount = activeTodos.length + doneToday.length;
  const todayPercent = todayTotalCount ? Math.round((doneToday.length / todayTotalCount) * 100) : 0;
  const todayMinutes = sumMinutes(doneToday);

  const minutesByDay = useMemo(() => {
    const map = new Map<string, number>();
    completedTodos.forEach((todo) => {
      if (!todo.completed_on) return;
      map.set(todo.completed_on, (map.get(todo.completed_on) || 0) + Number(todo.completed_minutes || 0));
    });
    return map;
  }, [completedTodos]);

  const heatmap = useMemo(() => {
    const today = new Date();
    const start = addDays(today, -364);
    const leading = start.getDay();
    const blanks = Array.from({ length: leading }, () => null);
    const days = Array.from({ length: 365 }, (_item, index) => {
      const day = addDays(start, index);
      const key = dateKey(day);
      const minutes = minutesByDay.get(key) || 0;
      return { key, minutes };
    });
    return [...blanks, ...days];
  }, [minutesByDay]);

  const yearMinutes = sumMinutes(completedTodos);
  const activeDays = Array.from(minutesByDay.values()).filter(Boolean).length;
  const streak = streakDays(minutesByDay);
  const winStreak = useMemo(() => todoWinStreak(todos, todayKey()), [todos]);
  const weeklyAverage = Array.from({ length: 7 }, (_item, index) => {
    const key = dateKey(addDays(new Date(), -index));
    return minutesByDay.get(key) || 0;
  }).reduce((sum, minutes) => sum + minutes, 0) / 7;
  const todayLabel = weekdayLabel(new Date());

  async function loadTodos(nextView = view) {
    const requestId = ++loadRequestRef.current;
    setIsLoading(true);
    const api = privateSpaceApi();
    try {
      if (!api?.ready) throw new Error("Private-space encryption is not ready.");
      await api.ready();
      const res = await fetch(`/api/todos?view=${nextView}`);
      const data = (await res.json()) as ApiState & { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load tasks");
      const decrypted = await decryptTodoRows(data.todos || []);
      if (requestId !== loadRequestRef.current) return;
      setTodos(decrypted);
      setCanEdit(data.canEdit);
      setMessage("");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      throw error;
    } finally {
      if (requestId === loadRequestRef.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    loadTodos(view).catch((error) => setMessage(error.message));
  }, [view]);

  useEffect(() => {
    if (!completionIds.length) return;
    document.documentElement.classList.add("has-open-dialog");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCompletionIds([]);
    };
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => modalCloseRef.current?.focus(), 0);
    return () => {
      document.documentElement.classList.remove("has-open-dialog");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [completionIds.length]);

  async function addTodo() {
    const title = draft.trim();
    if (!title) return;
    if (!draftDue) {
      setMessage("Please pick a due date first.");
      return;
    }
    try {
      await postForm("/api/todos/create", { title: await encryptPrivateTextValue(title), due_on: draftDue });
      setDraft("");
      await loadTodos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add task");
    }
  }

  async function saveEdit(id: string) {
    const title = editingTitle.trim();
    if (!title) {
      setMessage("A task needs a title. The original task was kept.");
      setEditingId(null);
      return;
    }
    try {
      await postForm("/api/todos/update", { id, title: await encryptPrivateTextValue(title) });
      setEditingId(null);
      await loadTodos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update task");
    }
  }

  async function deleteTodo(id: string) {
    const confirmDelete = (window as any).CBConfirmDelete as undefined | ((message: string, options?: Record<string, string>) => Promise<boolean>);
    const approved = confirmDelete
      ? await confirmDelete("Delete this task? This cannot be undone.", { title: "Delete task?" })
      : window.confirm("Delete this task? This cannot be undone.");
    if (!approved) return;
    try {
      await postForm("/api/todos/delete", { id });
      await loadTodos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete task");
    }
  }

  function requestCompletion(id: string) {
    setCompletionIds([id]);
    setCompletionMessage("");
    setCompletionDate(todayKey());
    setCompletionRanges([newRange()]);
  }

  async function completeSelected() {
    try {
      if (isCompleting) return;
      setIsCompleting(true);
      setCompletionMessage("");
      const normalizedRanges = completionRanges.map((range) => ({
        start_time: normalizeClock(range.start),
        end_time: normalizeClock(range.end),
      }));
      if (!normalizedRanges.length || normalizedRanges.some((range) => !isClock(range.start_time) || !isClock(range.end_time))) {
        setCompletionMessage("Use 24-hour time like 09:30 or 18:05.");
        return;
      }
      for (const id of completionIds) {
        const todo = todos.find((item) => item.id === id);
        await postForm("/api/todos/complete", {
          id,
          completed_on: completionDate,
          start_time: normalizedRanges[0].start_time,
          end_time: normalizedRanges[0].end_time,
          ranges: JSON.stringify(normalizedRanges),
          activity_body: await encryptPrivateTextValue(todo?.title || "Completed task"),
        });
      }
      setCompletionIds([]);
      setCompletionMessage("");
      await loadTodos();
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : "Could not complete task");
    } finally {
      setIsCompleting(false);
    }
  }

  async function uncomplete(id: string) {
    try {
      await postForm("/api/todos/uncomplete", { id });
      await loadTodos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reopen task");
    }
  }

  async function clearCompleted() {
    const confirmDelete = (window as any).CBConfirmDelete as undefined | ((message: string, options?: Record<string, string>) => Promise<boolean>);
    const approved = confirmDelete
      ? await confirmDelete("Clear every completed task from this list?", { title: "Clear completed tasks?", confirmText: "Clear" })
      : window.confirm("Clear every completed task from this list?");
    if (!approved) return;
    try {
      await postForm("/api/todos/clear-completed", {});
      await loadTodos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear completed tasks");
    }
  }

  function toggleAll() {
    if (activeTodos.length) {
      setCompletionIds(activeTodos.map((todo) => todo.id));
      setCompletionDate(todayKey());
      setCompletionRanges([newRange()]);
    } else if (listCompletedTodos.length) {
      Promise.all(listCompletedTodos.map((todo) => postForm("/api/todos/uncomplete", { id: todo.id })))
        .then(() => loadTodos())
        .catch((error) => setMessage(error instanceof Error ? error.message : "Could not reopen tasks"));
    }
  }

  const completionTitle = completionIds.length === 1
    ? todos.find((todo) => todo.id === completionIds[0])?.title || "Complete task"
    : `Complete ${completionIds.length} tasks`;
  const completionTotalMinutes = completionRanges.reduce((sum, range) => sum + rangeMinutes(range), 0);

  function updateCompletionRange(id: string, patch: Partial<Pick<CompletionRange, "start" | "end">>) {
    setCompletionRanges((ranges) => ranges.map((range) => (range.id === id ? { ...range, ...patch } : range)));
  }

  function normalizeCompletionRange(id: string, field: "start" | "end") {
    setCompletionRanges((ranges) =>
      ranges.map((range) => (range.id === id ? { ...range, [field]: normalizeClock(range[field]) } : range)),
    );
  }

  function addCompletionRange() {
    const last = completionRanges[completionRanges.length - 1];
    const start = last?.end && isClock(last.end) ? last.end : "09:00";
    setCompletionRanges((ranges) => [...ranges, newRange(start, addClockMinutes(start, 60))]);
  }

  function removeCompletionRange(id: string) {
    setCompletionRanges((ranges) => (ranges.length > 1 ? ranges.filter((range) => range.id !== id) : ranges));
  }

  return (
    <main className="todo-shell">
      <section className="todo-main" aria-labelledby="todoTitle">
        <header className="todo-hero">
          <p className="todo-kicker">A gentle little plan for the days ahead</p>
          <h1 id="todoTitle">To <em>Do.</em></h1>
          <p className="todo-summary">
            {selectedName} has <strong>{activeTodos.length}</strong> open tasks today, and a quiet streak of <strong>{streak} days</strong>.
          </p>

          <div className="todo-tools">
            <div className="todo-switch" aria-label="Choose todo owner">
              {(["white", "brown"] as AuthorKey[]).map((key) => (
                <button key={key} className={view === key ? "is-active" : ""} type="button" onClick={() => setView(key)}>
                  <i></i>{authorNames[key]}
                </button>
              ))}
            </div>
            <button className="todo-date-pill" type="button" aria-label="Today">
              <span>{todayLabel}</span>
            </button>
            <button className="todo-add-hero" type="button" onClick={() => inputRef.current?.focus()} disabled={!canEdit}>
              + Add a task
            </button>
          </div>
        </header>

        <section className="todo-card" aria-label={`${selectedName}'s todo list`}>
          <div className="todo-card__head">
            <div>
              <p>Today · {selectedName}'s list</p>
              <h2>{activeTodos.length} small things</h2>
            </div>
            <div className="todo-progress">
              <span>Progress</span>
              <strong>{doneToday.length}</strong>
              <small>/ {todayTotalCount} {todayTotalCount === 1 ? "task" : "tasks"}</small>
            </div>
          </div>

          {message && <p className="todo-message" role="alert">{message}</p>}
          {!canEdit && (
            <p className="todo-message">
              {profile ? `Current account can edit ${authorNames[currentAuthor || "white"]}'s list only.` : "Log in to add or edit tasks."}
            </p>
          )}

          <div className="todo-new">
            <button className="todo-toggle-all" type="button" onClick={toggleAll} disabled={!canEdit || !todos.length} aria-label="Toggle all tasks">
              {activeTodos.length ? "○" : "✓"}
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addTodo();
              }}
              placeholder={canEdit ? "Write a small thing to do..." : "Switch to your own list to add tasks"}
              disabled={!canEdit}
            />
            <input
              className="todo-new-due"
              type="date"
              value={draftDue}
              onChange={(event) => setDraftDue(event.target.value)}
              disabled={!canEdit}
              aria-label="Due date"
              title="Due date"
            />
            <button type="button" onClick={addTodo} disabled={!canEdit || !draft.trim() || !draftDue} aria-label="Add task">↗</button>
          </div>

          <div className="todo-filters" aria-label="Task filters">
            {(["all", "active", "completed"] as Filter[]).map((item) => (
              <button key={item} className={filter === item ? "is-active" : ""} type="button" onClick={() => setFilter(item)}>
                {item === "all" ? "All" : item === "active" ? "In bloom" : "Done"}
              </button>
            ))}
            <span>{activeTodos.length} left</span>
            <button type="button" onClick={clearCompleted} disabled={!canEdit || !listCompletedTodos.length}>Clear completed</button>
          </div>

          <div className="todo-list" aria-busy={isLoading} aria-live="polite">
            {isLoading ? (
              <div className="todo-loading" aria-label="Loading tasks">
                <span></span><span></span><span></span>
              </div>
            ) : visibleTodos.map((todo) => {
              const outcome = todoOutcome(todo, todayKey());
              return (
              <article
                key={todo.id}
                className={`todo-item ${todo.completed ? "is-completed" : ""} ${!todo.completed && outcome === "failure" ? "is-failed" : ""} ${todo.completed && outcome === "failure" ? "is-late" : ""}`}
              >
                <button
                  className="todo-check"
                  type="button"
                  disabled={!canEdit}
                  onClick={() => (todo.completed ? uncomplete(todo.id) : requestCompletion(todo.id))}
                  aria-label={todo.completed ? "Reopen task" : "Complete task"}
                >
                  {todo.completed ? "✓" : ""}
                </button>
                <div className="todo-item__body">
                  {editingId === todo.id ? (
                    <input
                      className="todo-edit"
                      value={editingTitle}
                      autoFocus
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onBlur={() => saveEdit(todo.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveEdit(todo.id);
                        if (event.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      className="todo-title"
                      type="button"
                      onDoubleClick={() => {
                        if (!canEdit) return;
                        setEditingId(todo.id);
                        setEditingTitle(todo.title);
                      }}
                    >
                      {todo.title}
                    </button>
                  )}
                  <p>
                    <span>{todo.completed ? "done" : outcome === "failure" ? "missed" : "open"}</span>
                    {!todo.completed && todo.due_on && (
                      <>
                        <i>·</i>
                        <span>{outcome === "failure" ? `was due ${todo.due_on}` : `due ${todo.due_on}`}</span>
                      </>
                    )}
                    {todo.completed && todo.completed_on && (
                      <>
                        <i>·</i>
                <span>{todo.completed_on}</span>
                {outcome === "failure" && (
                  <>
                    <i>·</i>
                    <span>late · was due {todo.due_on}</span>
                  </>
                )}
                {todoCompletionTimeLabels(todo).map((label) => (
                  <Fragment key={`${todo.id}-${label}`}>
                    <i>·</i>
                    <span>{label}</span>
                  </Fragment>
                ))}
                <i>·</i>
                <span>{fmtMinutes(todo.completed_minutes)}</span>
              </>
                    )}
                  </p>
                </div>
                <button className="todo-destroy" type="button" onClick={() => deleteTodo(todo.id)} disabled={!canEdit} aria-label="Delete task">×</button>
              </article>
              );
            })}
            {!isLoading && !visibleTodos.length && <p className="todo-empty">Nothing here yet. Tiny plans are welcome.</p>}
          </div>
        </section>

        <section className="todo-heat-card" aria-label="365 days of completed task effort">
          <div className="todo-heat-card__head">
            <div>
              <p>365 days of effort</p>
              <h2>A year in small squares</h2>
            </div>
            <div>
              <strong>{fmtMinutes(yearMinutes)}</strong>
              <span>{activeDays} active days</span>
            </div>
          </div>
          <div className="todo-heatmap" role="img" aria-label="Daily completed task duration heatmap">
            {heatmap.map((day, index) => (
              day ? (
                <span
                  key={day.key}
                  className={`todo-square level-${heatLevel(day.minutes)}`}
                  title={`${day.key}: ${fmtMinutes(day.minutes)}`}
                ></span>
              ) : <span key={`blank-${index}`} className="todo-square is-blank"></span>
            ))}
          </div>
          <div className="todo-heat-legend">
            <span>quiet</span>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((level) => <i key={level} className={`level-${level}`}></i>)}
            <span>a full day</span>
          </div>
        </section>
      </section>

      <aside className="todo-side" aria-label="Task time stats">
        <section className="todo-side-card">
          <p>{selectedName}'s day at a glance</p>
          <h2><span className="todo-stat-number">{todayPercent}%</span> of today, done.</h2>
          <div className="todo-ring-row">
            <div className="todo-ring" style={{ "--p": `${todayPercent}%` } as CSSProperties}>
              <span>{fmtMinutes(todayMinutes)}</span>
            </div>
            <dl>
              <div><dt>Completed</dt><dd>{doneToday.length} / {todayTotalCount}</dd></div>
              <div><dt>Win streak</dt><dd>{winStreak} {winStreak === 1 ? "task" : "tasks"}</dd></div>
              <div><dt>Day streak</dt><dd>{streak} days</dd></div>
              <div><dt>Weekly avg</dt><dd>{(weeklyAverage / 60).toFixed(1)} hr</dd></div>
            </dl>
          </div>
          <blockquote>Small commits, every day. The page can wait; the little thing counts.</blockquote>
        </section>
        <section className="todo-side-card">
          <p>A nudge for the week</p>
          <h2>{streak >= 3 ? "Three days of momentum. Nice." : activeTodos.length ? "One gentle task is enough." : "A quiet list today."}</h2>
          <span>Finish tasks first, then record the real time. The log will stay honest.</span>
        </section>
      </aside>

      {completionIds.length > 0 && (
        <div className="todo-modal" role="dialog" aria-modal="true" aria-labelledby="todoCompleteTitle">
          <div className="todo-modal__mask" onClick={() => setCompletionIds([])}></div>
          <section className="todo-modal__card">
            <button ref={modalCloseRef} type="button" className="todo-modal__close" onClick={() => setCompletionIds([])} aria-label="Close">×</button>
            <p>Completion time</p>
            <h2 id="todoCompleteTitle">{completionTitle}</h2>
            {completionMessage && <div className="todo-modal__message" role="alert">{completionMessage}</div>}
            <label>
              <span>Date</span>
              <input type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} />
            </label>
            <div className="todo-modal__row">
              <span>Time ranges</span>
              <strong>{fmtMinutes(completionTotalMinutes)}</strong>
            </div>
            <div className="todo-range-list">
              {completionRanges.map((range, index) => (
                <div className="todo-range-row" key={range.id}>
                  <span>{index + 1}</span>
                  <label>
                    <span>Start</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="^([01]\d|2[0-3]):[0-5]\d$"
                      placeholder="09:00"
                      value={range.start}
                      onChange={(event) => updateCompletionRange(range.id, { start: event.target.value })}
                      onBlur={() => normalizeCompletionRange(range.id, "start")}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="^([01]\d|2[0-3]):[0-5]\d$"
                      placeholder="10:00"
                      value={range.end}
                      onChange={(event) => updateCompletionRange(range.id, { end: event.target.value })}
                      onBlur={() => normalizeCompletionRange(range.id, "end")}
                    />
                  </label>
                  <button type="button" onClick={() => removeCompletionRange(range.id)} disabled={completionRanges.length === 1} aria-label="Remove time range">-</button>
                </div>
              ))}
            </div>
            <div className="todo-modal__actions">
              <button type="button" onClick={addCompletionRange}>Add range</button>
              <button type="button" onClick={() => setCompletionIds([])} disabled={isCompleting}>Cancel</button>
              <button type="button" onClick={completeSelected} disabled={isCompleting}>{isCompleting ? "Saving..." : "Save completion"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
