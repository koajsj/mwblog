-- Private-space membership is derived from Auth and must never be client-editable.
create or replace function public.prevent_private_profile_identity_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.email is distinct from old.email
    or new.author_key is distinct from old.author_key
    or new.space_id is distinct from old.space_id then
    raise exception 'Private-space identity fields cannot be changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_private_profile_identity_change on public.profiles;
create trigger prevent_private_profile_identity_change
before update on public.profiles
for each row execute function public.prevent_private_profile_identity_change();

-- Keep direct Supabase clients limited to the fields used by the status APIs.
revoke update on public.profiles from anon, authenticated;
grant update (
  weather_text,
  weather_updated_at,
  weather_lat,
  weather_lng,
  weather_label,
  mood_text,
  mood_date,
  doing_text,
  doing_date
) on public.profiles to authenticated;

-- A fixed space has one bootstrap key. Rotation requires an explicit migration,
-- never a client-side upsert that could make existing content unrecoverable.
drop policy if exists "couple members can update private space key bundle" on public.private_space_keys;
