create table if not exists public.life_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  record_on date not null,
  mood text not null default 'happy',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_records_mood_check check (mood in ('happy', 'loved', 'calm', 'tired', 'down', 'moody'))
);

create index if not exists life_records_owner_date_idx
on public.life_records (owner_id, record_on desc, created_at desc);

drop trigger if exists touch_life_records_updated_at on public.life_records;
create trigger touch_life_records_updated_at
before update on public.life_records
for each row execute function public.touch_updated_at();

alter table public.life_records enable row level security;

drop policy if exists "life records are readable" on public.life_records;
create policy "life records are readable"
on public.life_records for select
using (true);

drop policy if exists "owners can insert life records" on public.life_records;
create policy "owners can insert life records"
on public.life_records for insert
with check (auth.uid() = owner_id);

drop policy if exists "owners can update life records" on public.life_records;
create policy "owners can update life records"
on public.life_records for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners can delete life records" on public.life_records;
create policy "owners can delete life records"
on public.life_records for delete
using (auth.uid() = owner_id);
