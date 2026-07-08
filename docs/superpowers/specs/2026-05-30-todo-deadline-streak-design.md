# To Do 截止日期与连续成功统计 — 设计

最后更新：2026-05-30

## 目标

给每个待办任务加上**截止日期（due date）**：

1. 新建任务时必填截止日期。
2. 超过截止日期仍未完成的任务算作「失败」。
3. 侧边栏统计**当前连续成功完成任务的次数**（连胜）。

## 决策（已与用户确认）

- **截止日期强制度**：新任务必填；老任务（数据库已有、无 `due_on`）永不失败，也不进成功/失败/连胜统计。
- **成功/失败判定**：按时完成 = 成功；过期未完成 = 失败。
- **逾期补完**：`completed_on > due_on` 算失败，打断连胜。
- **连胜算法**：按完成/结算时间先后累计，遇成功 +1、遇失败归 0，取当前值。

## 方案

全部派生（不持久化状态）。数据库只加 `due_on` 字段，失败状态和连胜次数都在前端从已加载的任务列表实时计算，与现有 `streak`、热力图同一套路。

## 数据模型

新增迁移 `supabase/migrations/013_todo_due_date.sql`：

```sql
alter table public.todos add column if not exists due_on date;
create index if not exists todos_owner_due_idx on public.todos (owner_id, due_on);
```

- `due_on` 可空，**不加 NOT NULL**（避免破坏老数据）；「新任务必填」只在 `create.ts` 强制。
- `TodoItem` 类型加 `due_on: string | null`。
- `GET /api/todos` 与 `create.ts` 的 select 字段加 `due_on`。

## 新建任务

- `create.ts` 接收并校验 `due_on`（`YYYY-MM-DD`，缺失/非法返回 400）。
- UI：`todo-new` 行的文字输入框旁加 `<input type="date">`，默认今天；标题和日期都填了才能添加。

## 成功/失败判定（派生）

对有 `due_on` 的任务：

| 情况 | 判定 |
|---|---|
| 已完成且 `completed_on ≤ due_on` | 成功 |
| 已完成但 `completed_on > due_on` | 失败（逾期补完） |
| 未完成且 `今天 > due_on` | 失败（逾期未完成） |
| 未完成且 `今天 ≤ due_on` | 待定（不进统计） |

无 `due_on`：永远待定。

## 连续成功次数

把所有已结算（成功或失败）任务按结算日期升序排成时间线：

- 成功 → 结算日期 = `completed_on`
- 逾期补完（失败）→ 结算日期 = `completed_on`
- 逾期未完成（失败）→ 结算日期 = `due_on`
- 同日并列按 `updated_at` 兜底排序

从头遍历维护计数器：成功 +1，失败归 0。遍历完最后一个事件后的值 = 当前连续成功次数。待定任务、无期限老任务不产生事件。

抽成纯函数 `todoWinStreak(todos, today)` 放进 `src/lib/todo-display.ts`，配单测。

## UI 展示

- 逾期未完成任务留在列表，加 `is-failed` 样式（暖灰/淡红）+ 文案 `missed · was due <date>`，仍可逾期补完或删除。
- 逾期补完的已完成任务标 `late` 小标记。
- 侧边栏 `todo-side-card` 的 `<dl>` 加一行 **Win streak = N**（现有「Streak 天数」保留）。

## 不改动

完成弹窗、Activity 联动、热力图、软隐藏删除逻辑均不动——成功/失败纯派生，不改 `complete.ts`。

## 涉及文件

`supabase/migrations/013_todo_due_date.sql`(新)、`src/lib/types.ts`、`src/pages/api/todos/create.ts`、`src/pages/api/todos/index.ts`、`src/components/TodoApp.tsx`、`src/lib/todo-display.ts`、`src/lib/todo-display.test.ts`、`public/styles/todo.css`。
