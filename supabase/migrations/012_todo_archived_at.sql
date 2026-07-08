alter table public.todos
add column if not exists archived_at timestamptz;

create index if not exists todos_owner_archived_idx
on public.todos (owner_id, archived_at, created_at desc);
