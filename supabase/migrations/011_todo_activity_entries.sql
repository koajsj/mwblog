create table if not exists public.todo_activity_entries (
  todo_id uuid not null references public.todos(id) on delete cascade,
  activity_entry_id uuid not null references public.activity_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (todo_id, activity_entry_id)
);

create index if not exists todo_activity_entries_activity_idx
on public.todo_activity_entries (activity_entry_id);

insert into public.todo_activity_entries (todo_id, activity_entry_id)
select id, activity_entry_id
from public.todos
where activity_entry_id is not null
on conflict do nothing;

alter table public.todo_activity_entries enable row level security;

drop policy if exists "todo activity links are readable" on public.todo_activity_entries;
create policy "todo activity links are readable"
on public.todo_activity_entries for select
using (true);

drop policy if exists "owners can insert todo activity links" on public.todo_activity_entries;
create policy "owners can insert todo activity links"
on public.todo_activity_entries for insert
with check (
  exists (
    select 1 from public.todos
    where todos.id = todo_activity_entries.todo_id
      and todos.owner_id = auth.uid()
  )
);

drop policy if exists "owners can delete todo activity links" on public.todo_activity_entries;
create policy "owners can delete todo activity links"
on public.todo_activity_entries for delete
using (
  exists (
    select 1 from public.todos
    where todos.id = todo_activity_entries.todo_id
      and todos.owner_id = auth.uid()
  )
);
