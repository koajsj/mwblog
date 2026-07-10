create table if not exists public.private_space_keys (
  space_id text primary key default public.private_space_id(),
  bundle jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint private_space_keys_fixed_space check (space_id = public.private_space_id())
);

alter table public.private_space_keys enable row level security;

drop policy if exists "couple members can read private space key bundle" on public.private_space_keys;
create policy "couple members can read private space key bundle"
  on public.private_space_keys
  for select
  using (public.is_couple_member() and space_id = public.private_space_id());

drop policy if exists "couple members can insert private space key bundle" on public.private_space_keys;
create policy "couple members can insert private space key bundle"
  on public.private_space_keys
  for insert
  with check (
    public.is_couple_member()
    and space_id = public.private_space_id()
    and auth.uid() = created_by
    and auth.uid() = updated_by
  );

drop policy if exists "couple members can update private space key bundle" on public.private_space_keys;
create policy "couple members can update private space key bundle"
  on public.private_space_keys
  for update
  using (public.is_couple_member() and space_id = public.private_space_id())
  with check (
    public.is_couple_member()
    and space_id = public.private_space_id()
    and auth.uid() = updated_by
  );
