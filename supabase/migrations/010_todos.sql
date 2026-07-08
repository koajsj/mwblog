create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  completed_on date,
  completed_start_time time without time zone,
  completed_end_time time without time zone,
  completed_minutes integer not null default 0,
  activity_entry_id uuid references public.activity_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todos_title_check check (char_length(trim(title)) between 1 and 120),
  constraint todos_completed_minutes_check check (completed_minutes >= 0 and completed_minutes <= 1440),
  constraint todos_completed_time_check check (
    completed = false
    or (completed_on is not null and completed_start_time is not null and completed_end_time is not null and completed_minutes > 0)
  )
);

create index if not exists todos_owner_created_idx
on public.todos (owner_id, created_at desc);

create index if not exists todos_owner_completed_idx
on public.todos (owner_id, completed_on desc)
where completed = true;

drop trigger if exists touch_todos_updated_at on public.todos;
create trigger touch_todos_updated_at
before update on public.todos
for each row execute function public.touch_updated_at();

alter table public.todos enable row level security;

drop policy if exists "todos are readable" on public.todos;
create policy "todos are readable"
on public.todos for select
using (true);

drop policy if exists "owners can insert todos" on public.todos;
create policy "owners can insert todos"
on public.todos for insert
with check (auth.uid() = owner_id);

drop policy if exists "owners can update todos" on public.todos;
create policy "owners can update todos"
on public.todos for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners can delete todos" on public.todos;
create policy "owners can delete todos"
on public.todos for delete
using (auth.uid() = owner_id);
