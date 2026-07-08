create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  note text not null,
  tone text not null default 'night',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_tone_check check (tone in ('night', 'desert', 'forest', 'sea')),
  constraint places_name_length check (char_length(name) between 1 and 32),
  constraint places_note_length check (char_length(note) between 1 and 140)
);

create index if not exists places_created_idx
on public.places (created_at desc);

drop trigger if exists touch_places_updated_at on public.places;
create trigger touch_places_updated_at
before update on public.places
for each row execute function public.touch_updated_at();

alter table public.places enable row level security;

drop policy if exists "places are readable" on public.places;
create policy "places are readable"
on public.places for select
using (true);

drop policy if exists "owners can insert places" on public.places;
create policy "owners can insert places"
on public.places for insert
with check (auth.uid() = owner_id);

drop policy if exists "owners can update places" on public.places;
create policy "owners can update places"
on public.places for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners can delete places" on public.places;
create policy "owners can delete places"
on public.places for delete
using (auth.uid() = owner_id);
