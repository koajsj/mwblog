-- New writes use context-bound wc2 ciphertext. Existing wc1 rows remain
-- readable until the explicit client-encryption migration upgrades them.
create or replace function public.is_client_private_ciphertext(value text)
returns boolean
language sql
immutable
as $$
  select value is not null and value ~ '^enc:wc[12]:[A-Za-z0-9_-]+$'
$$;

create or replace function public.is_nullable_client_private_ciphertext(value text)
returns boolean
language sql
immutable
as $$
  select value is null or public.is_client_private_ciphertext(value)
$$;

create or replace function public.is_context_bound_ciphertext(value text, expected_context text)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_catalog
as $$
declare
  encoded text;
  normalized text;
  payload jsonb;
begin
  if value !~ '^enc:wc2:[A-Za-z0-9_-]+$' then
    return false;
  end if;

  encoded := substring(value from 9);
  normalized := replace(replace(encoded, '-', '+'), '_', '/');
  normalized := normalized || repeat('=', (4 - length(normalized) % 4) % 4);
  payload := convert_from(decode(normalized, 'base64'), 'UTF8')::jsonb;

  return payload->>'context' = expected_context
    and payload->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
    and payload->>'data' ~ '^[A-Za-z0-9_-]{22,}$';
exception when others then
  return false;
end;
$$;

revoke all on function public.is_context_bound_ciphertext(text, text) from public, anon, authenticated;

create table if not exists public.private_security_state (
  space_id text primary key,
  version integer not null default 22,
  verified_at timestamptz,
  constraint private_security_state_fixed_space check (space_id = public.private_space_id())
);

alter table public.private_security_state enable row level security;
revoke all on public.private_security_state from anon, authenticated;

create or replace function public.enforce_context_bound_private_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  field_name text;
  expected_context text;
  new_value jsonb;
  old_value jsonb;
  item text;
  index integer;
begin
  if tg_nargs = 0 or tg_nargs % 2 <> 0 then
    raise exception 'Invalid private-field trigger configuration.';
  end if;

  -- Keep wc1 rows operational during the controlled migration window. The
  -- verifier flips this marker only after every database and Storage item has
  -- passed authenticated wc2 decryption.
  if not exists (
    select 1 from public.private_security_state
    where space_id = public.private_space_id() and version >= 23
  ) then
    return new;
  end if;

  index := 0;
  while index < tg_nargs loop
    field_name := tg_argv[index];
    expected_context := tg_argv[index + 1];
    new_value := to_jsonb(new)->field_name;
    old_value := case when tg_op = 'UPDATE' then to_jsonb(old)->field_name else null end;

    if tg_op = 'INSERT' or new_value is distinct from old_value then
      if jsonb_typeof(new_value) = 'array' then
        for item in select jsonb_array_elements_text(new_value) loop
          if not public.is_context_bound_ciphertext(item, expected_context) then
            raise exception 'Sensitive field % must use context-bound client ciphertext.', field_name;
          end if;
        end loop;
      elsif new_value is not null and new_value <> 'null'::jsonb
        and not public.is_context_bound_ciphertext(new_value #>> '{}', expected_context) then
        raise exception 'Sensitive field % must use context-bound client ciphertext.', field_name;
      end if;
    end if;
    index := index + 2;
  end loop;

  return new;
end;
$$;

revoke all on function public.enforce_context_bound_private_fields() from public, anon, authenticated;

drop trigger if exists enforce_blog_context_bound_ciphertext on public.blog_posts;
create trigger enforce_blog_context_bound_ciphertext before insert or update on public.blog_posts
for each row execute function public.enforce_context_bound_private_fields(
  'title', 'blog.title', 'excerpt', 'blog.excerpt', 'content_markdown', 'blog.content', 'tags', 'blog.tag'
);

drop trigger if exists enforce_photo_context_bound_ciphertext on public.photos;
create trigger enforce_photo_context_bound_ciphertext before insert or update on public.photos
for each row execute function public.enforce_context_bound_private_fields('title', 'photo.title', 'caption', 'photo.caption');

drop trigger if exists enforce_record_context_bound_ciphertext on public.life_records;
create trigger enforce_record_context_bound_ciphertext before insert or update on public.life_records
for each row execute function public.enforce_context_bound_private_fields('body', 'record.body');

drop trigger if exists enforce_activity_context_bound_ciphertext on public.activity_entries;
create trigger enforce_activity_context_bound_ciphertext before insert or update on public.activity_entries
for each row execute function public.enforce_context_bound_private_fields('body', 'activity.body');

drop trigger if exists enforce_place_context_bound_ciphertext on public.places;
create trigger enforce_place_context_bound_ciphertext before insert or update on public.places
for each row execute function public.enforce_context_bound_private_fields('name', 'place.name', 'note', 'place.note');

drop trigger if exists enforce_comment_context_bound_ciphertext on public.comments;
create trigger enforce_comment_context_bound_ciphertext before insert or update on public.comments
for each row execute function public.enforce_context_bound_private_fields('body', 'comment.body');

drop trigger if exists enforce_todo_context_bound_ciphertext on public.todos;
create trigger enforce_todo_context_bound_ciphertext before insert or update on public.todos
for each row execute function public.enforce_context_bound_private_fields('title', 'todo.title');

drop trigger if exists enforce_profile_context_bound_ciphertext on public.profiles;
create trigger enforce_profile_context_bound_ciphertext before insert or update on public.profiles
for each row execute function public.enforce_context_bound_private_fields(
  'weather_text', 'profile.weather', 'mood_text', 'profile.mood', 'doing_text', 'profile.doing'
);

insert into public.private_security_state (space_id, version)
select public.private_space_id(),
  case when not exists (select 1 from public.private_space_keys)
    and not exists (select 1 from public.blog_posts)
    and not exists (select 1 from public.photos)
    and not exists (select 1 from public.life_records)
    and not exists (select 1 from public.activity_entries)
    and not exists (select 1 from public.places)
    and not exists (select 1 from public.comments)
    and not exists (select 1 from public.todos)
  then 23 else 22 end
on conflict (space_id) do nothing;

create or replace function public.private_security_version()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_couple_member()
      and exists (
        select 1 from public.private_security_state
        where space_id = public.private_space_id() and version >= 23
      )
      and (
        not exists (select 1 from public.private_space_keys where space_id = public.private_space_id())
        or exists (
          select 1 from public.private_space_keys
          where space_id = public.private_space_id()
            and coalesce((bundle #>> '{kdf,iterations}')::integer, 0) >= 600000
        )
      )
    then 23
    else 22
  end
$$;

revoke all on function public.private_security_version() from public, anon;
grant execute on function public.private_security_version() to authenticated;

update storage.buckets
set public = false
where id in ('photos', 'blog-markdown');
