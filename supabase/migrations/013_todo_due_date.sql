-- To Do 截止日期。可空：老任务无截止日期、永不失败。
-- 「新任务必填」只在应用层 (api/todos/create.ts) 强制，避免破坏已有数据。
alter table public.todos
add column if not exists due_on date;

create index if not exists todos_owner_due_idx
on public.todos (owner_id, due_on);
