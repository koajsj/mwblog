create or replace function public.private_space_id()
returns text
language sql
immutable
as $$
  select 'private-couple-space'::text
$$;

create or replace function public.private_account_author(input_email text)
returns public.author_key
language sql
immutable
as $$
  select case lower(coalesce(input_email, ''))
    when 'kikou@our-nest.local' then 'white'::public.author_key
    when 'scoinmic@our-nest.local' then 'brown'::public.author_key
    else null
  end
$$;

create or replace function public.private_account_display_name(input_email text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(input_email, ''))
    when 'kikou@our-nest.local' then 'kikou'
    when 'scoinmic@our-nest.local' then 'scoinmic'
    else null
  end
$$;

create or replace function public.private_account_code(input_email text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(input_email, ''))
    when 'kikou@our-nest.local' then 'kikou'
    when 'scoinmic@our-nest.local' then 'scoinmic'
    else null
  end
$$;

create or replace function public.is_private_account_email(input_email text)
returns boolean
language sql
immutable
as $$
  select public.private_account_author(input_email) is not null
$$;

create or replace function public.guard_private_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  locked_author public.author_key;
  locked_name text;
  locked_account text;
begin
  if new.email is null or not public.is_private_account_email(new.email) then
    raise exception 'This site is private. Public sign-up is disabled.';
  end if;

  locked_author := public.private_account_author(new.email);
  locked_name := public.private_account_display_name(new.email);
  locked_account := public.private_account_code(new.email);

  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'account', locked_account,
    'author_key', locked_author::text,
    'display_name', locked_name
  );

  return new;
end;
$$;

drop trigger if exists guard_private_auth_user on auth.users;
create trigger guard_private_auth_user
before insert or update of email on auth.users
for each row execute function public.guard_private_auth_user();

alter table public.profiles add column if not exists space_id text;
update public.profiles
set space_id = public.private_space_id(),
    email = lower(email),
    author_key = public.private_account_author(email),
    display_name = coalesce(public.private_account_display_name(email), display_name)
where public.is_private_account_email(email);
alter table public.profiles alter column space_id set default public.private_space_id();
update public.profiles set space_id = public.private_space_id() where space_id is null;
alter table public.profiles alter column space_id set not null;
alter table public.profiles drop constraint if exists profiles_space_id_check;
alter table public.profiles add constraint profiles_space_id_check check (space_id = public.private_space_id());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_author public.author_key;
  selected_name text;
begin
  selected_author := public.private_account_author(new.email);
  selected_name := public.private_account_display_name(new.email);

  if selected_author is null or selected_name is null then
    raise exception 'This account is not allowed in the private space.';
  end if;

  insert into public.profiles (id, email, author_key, display_name, space_id)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    selected_author,
    selected_name,
    public.private_space_id()
  )
  on conflict (id) do update
  set email = excluded.email,
      author_key = excluded.author_key,
      display_name = excluded.display_name,
      space_id = excluded.space_id;

  return new;
end;
$$;

alter table public.blog_posts add column if not exists space_id text;
update public.blog_posts set space_id = public.private_space_id() where space_id is null;
alter table public.blog_posts alter column space_id set default public.private_space_id();
alter table public.blog_posts alter column space_id set not null;
alter table public.blog_posts drop constraint if exists blog_posts_space_id_check;
alter table public.blog_posts add constraint blog_posts_space_id_check check (space_id = public.private_space_id());

alter table public.photos add column if not exists space_id text;
update public.photos set space_id = public.private_space_id() where space_id is null;
alter table public.photos alter column space_id set default public.private_space_id();
alter table public.photos alter column space_id set not null;
alter table public.photos drop constraint if exists photos_space_id_check;
alter table public.photos add constraint photos_space_id_check check (space_id = public.private_space_id());

alter table public.life_records add column if not exists space_id text;
update public.life_records set space_id = public.private_space_id() where space_id is null;
alter table public.life_records alter column space_id set default public.private_space_id();
alter table public.life_records alter column space_id set not null;
alter table public.life_records drop constraint if exists life_records_space_id_check;
alter table public.life_records add constraint life_records_space_id_check check (space_id = public.private_space_id());

alter table public.activity_entries add column if not exists space_id text;
update public.activity_entries set space_id = public.private_space_id() where space_id is null;
alter table public.activity_entries alter column space_id set default public.private_space_id();
alter table public.activity_entries alter column space_id set not null;
alter table public.activity_entries drop constraint if exists activity_entries_space_id_check;
alter table public.activity_entries add constraint activity_entries_space_id_check check (space_id = public.private_space_id());

alter table public.places add column if not exists space_id text;
update public.places set space_id = public.private_space_id() where space_id is null;
alter table public.places alter column space_id set default public.private_space_id();
alter table public.places alter column space_id set not null;
alter table public.places drop constraint if exists places_space_id_check;
alter table public.places add constraint places_space_id_check check (space_id = public.private_space_id());

alter table public.comments add column if not exists space_id text;
update public.comments set space_id = public.private_space_id() where space_id is null;
alter table public.comments alter column space_id set default public.private_space_id();
alter table public.comments alter column space_id set not null;
alter table public.comments drop constraint if exists comments_space_id_check;
alter table public.comments add constraint comments_space_id_check check (space_id = public.private_space_id());

alter table public.todos add column if not exists space_id text;
update public.todos set space_id = public.private_space_id() where space_id is null;
alter table public.todos alter column space_id set default public.private_space_id();
alter table public.todos alter column space_id set not null;
alter table public.todos drop constraint if exists todos_space_id_check;
alter table public.todos add constraint todos_space_id_check check (space_id = public.private_space_id());

alter table public.todo_activity_entries add column if not exists space_id text;
update public.todo_activity_entries set space_id = public.private_space_id() where space_id is null;
alter table public.todo_activity_entries alter column space_id set default public.private_space_id();
alter table public.todo_activity_entries alter column space_id set not null;
alter table public.todo_activity_entries drop constraint if exists todo_activity_entries_space_id_check;
alter table public.todo_activity_entries add constraint todo_activity_entries_space_id_check check (space_id = public.private_space_id());

create or replace function public.is_couple_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and space_id = public.private_space_id()
      and (
        (author_key = 'white' and lower(email) = 'kikou@our-nest.local')
        or (author_key = 'brown' and lower(email) = 'scoinmic@our-nest.local')
      )
  );
$$;

revoke all on function public.is_couple_member() from public;
grant execute on function public.is_couple_member() to anon, authenticated;

create or replace function public.comment_target_exists(target_type text, target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_type = 'blog' then exists (
      select 1 from public.blog_posts
      where id = target_id
        and space_id = public.private_space_id()
    )
    when target_type = 'record' then exists (
      select 1 from public.life_records
      where id = target_id
        and space_id = public.private_space_id()
    )
    else false
  end
$$;

revoke all on function public.comment_target_exists(text, uuid) from public;
grant execute on function public.comment_target_exists(text, uuid) to anon, authenticated;

drop policy if exists "profiles are readable by couple members" on public.profiles;
create policy "profiles are readable by couple members"
on public.profiles for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "profiles can be updated by owner" on public.profiles;
create policy "profiles can be updated by owner"
on public.profiles for update
using (
  public.is_couple_member()
  and auth.uid() = id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = id
  and space_id = public.private_space_id()
);

drop policy if exists "posts are readable by couple members" on public.blog_posts;
create policy "posts are readable by couple members"
on public.blog_posts for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "authors can insert posts" on public.blog_posts;
create policy "authors can insert posts"
on public.blog_posts for insert
with check (
  public.is_couple_member()
  and auth.uid() = author_id
  and space_id = public.private_space_id()
);

drop policy if exists "authors can update posts" on public.blog_posts;
create policy "authors can update posts"
on public.blog_posts for update
using (
  public.is_couple_member()
  and auth.uid() = author_id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = author_id
  and space_id = public.private_space_id()
);

drop policy if exists "authors can delete posts" on public.blog_posts;
create policy "authors can delete posts"
on public.blog_posts for delete
using (
  public.is_couple_member()
  and auth.uid() = author_id
  and space_id = public.private_space_id()
);

drop policy if exists "photos are readable by couple members" on public.photos;
create policy "photos are readable by couple members"
on public.photos for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "owners can insert photos" on public.photos;
create policy "owners can insert photos"
on public.photos for insert
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can update photos" on public.photos;
create policy "owners can update photos"
on public.photos for update
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can delete photos" on public.photos;
create policy "owners can delete photos"
on public.photos for delete
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "life records are readable by couple members" on public.life_records;
create policy "life records are readable by couple members"
on public.life_records for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "owners can insert life records" on public.life_records;
create policy "owners can insert life records"
on public.life_records for insert
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can update life records" on public.life_records;
create policy "owners can update life records"
on public.life_records for update
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can delete life records" on public.life_records;
create policy "owners can delete life records"
on public.life_records for delete
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "activity entries are readable by couple members" on public.activity_entries;
create policy "activity entries are readable by couple members"
on public.activity_entries for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "owners can insert activity entries" on public.activity_entries;
create policy "owners can insert activity entries"
on public.activity_entries for insert
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can update activity entries" on public.activity_entries;
create policy "owners can update activity entries"
on public.activity_entries for update
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can delete activity entries" on public.activity_entries;
create policy "owners can delete activity entries"
on public.activity_entries for delete
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "places are readable by couple members" on public.places;
create policy "places are readable by couple members"
on public.places for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "owners can insert places" on public.places;
create policy "owners can insert places"
on public.places for insert
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can update places" on public.places;
create policy "owners can update places"
on public.places for update
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can delete places" on public.places;
create policy "owners can delete places"
on public.places for delete
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "comments are readable by couple members" on public.comments;
create policy "comments are readable by couple members"
on public.comments for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "users can insert their own comments" on public.comments;
create policy "users can insert their own comments"
on public.comments for insert
with check (
  public.is_couple_member()
  and auth.uid() = author_id
  and space_id = public.private_space_id()
  and public.comment_target_exists(target_type, target_id)
);

drop policy if exists "authors can delete their own comments" on public.comments;
create policy "authors can delete their own comments"
on public.comments for delete
using (
  public.is_couple_member()
  and auth.uid() = author_id
  and space_id = public.private_space_id()
);

drop policy if exists "todos are readable by couple members" on public.todos;
create policy "todos are readable by couple members"
on public.todos for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "owners can insert todos" on public.todos;
create policy "owners can insert todos"
on public.todos for insert
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can update todos" on public.todos;
create policy "owners can update todos"
on public.todos for update
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
)
with check (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "owners can delete todos" on public.todos;
create policy "owners can delete todos"
on public.todos for delete
using (
  public.is_couple_member()
  and auth.uid() = owner_id
  and space_id = public.private_space_id()
);

drop policy if exists "todo activity links are readable by couple members" on public.todo_activity_entries;
create policy "todo activity links are readable by couple members"
on public.todo_activity_entries for select
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
);

drop policy if exists "owners can insert todo activity links" on public.todo_activity_entries;
create policy "owners can insert todo activity links"
on public.todo_activity_entries for insert
with check (
  public.is_couple_member()
  and space_id = public.private_space_id()
  and exists (
    select 1 from public.todos
    where todos.id = todo_activity_entries.todo_id
      and todos.owner_id = auth.uid()
      and todos.space_id = public.private_space_id()
  )
  and exists (
    select 1 from public.activity_entries
    where activity_entries.id = todo_activity_entries.activity_entry_id
      and activity_entries.owner_id = auth.uid()
      and activity_entries.space_id = public.private_space_id()
  )
);

drop policy if exists "owners can delete todo activity links" on public.todo_activity_entries;
create policy "owners can delete todo activity links"
on public.todo_activity_entries for delete
using (
  public.is_couple_member()
  and space_id = public.private_space_id()
  and exists (
    select 1 from public.todos
    where todos.id = todo_activity_entries.todo_id
      and todos.owner_id = auth.uid()
      and todos.space_id = public.private_space_id()
  )
);

drop policy if exists "couple members can read photos bucket" on storage.objects;
create policy "couple members can read photos bucket"
on storage.objects for select
using (
  bucket_id = 'photos'
  and public.is_couple_member()
);
