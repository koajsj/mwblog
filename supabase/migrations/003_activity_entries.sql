create table if not exists public.activity_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  activity_on date not null,
  period text not null,
  category text not null,
  minutes integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_entries_period_check check (period in ('morning', 'forenoon', 'noon', 'afternoon', 'dusk', 'evening', 'midnight')),
  constraint activity_entries_category_check check (category in ('学习', '工作', '约会', '家务', '娱乐', '休息', '运动', '其他')),
  constraint activity_entries_minutes_check check (minutes >= 1 and minutes <= 720)
);

create index if not exists activity_entries_owner_date_idx
on public.activity_entries (owner_id, activity_on desc, period, created_at);

drop trigger if exists touch_activity_entries_updated_at on public.activity_entries;
create trigger touch_activity_entries_updated_at
before update on public.activity_entries
for each row execute function public.touch_updated_at();

alter table public.activity_entries enable row level security;

drop policy if exists "activity entries are readable" on public.activity_entries;
create policy "activity entries are readable"
on public.activity_entries for select
using (true);

drop policy if exists "owners can insert activity entries" on public.activity_entries;
create policy "owners can insert activity entries"
on public.activity_entries for insert
with check (auth.uid() = owner_id);

drop policy if exists "owners can update activity entries" on public.activity_entries;
create policy "owners can update activity entries"
on public.activity_entries for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners can delete activity entries" on public.activity_entries;
create policy "owners can delete activity entries"
on public.activity_entries for delete
using (auth.uid() = owner_id);
