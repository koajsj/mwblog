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
      and author_key in ('white', 'brown')
  );
$$;

revoke all on function public.is_couple_member() from public;
grant execute on function public.is_couple_member() to anon, authenticated;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable by couple members"
on public.profiles for select
using (public.is_couple_member());

drop policy if exists "posts are readable" on public.blog_posts;
create policy "posts are readable by couple members"
on public.blog_posts for select
using (public.is_couple_member());

drop policy if exists "photos are readable" on public.photos;
create policy "photos are readable by couple members"
on public.photos for select
using (public.is_couple_member());

drop policy if exists "life records are readable" on public.life_records;
create policy "life records are readable by couple members"
on public.life_records for select
using (public.is_couple_member());

drop policy if exists "activity entries are readable" on public.activity_entries;
create policy "activity entries are readable by couple members"
on public.activity_entries for select
using (public.is_couple_member());

drop policy if exists "places are readable" on public.places;
create policy "places are readable by couple members"
on public.places for select
using (public.is_couple_member());

drop policy if exists "comments are readable" on public.comments;
create policy "comments are readable by couple members"
on public.comments for select
using (public.is_couple_member());

drop policy if exists "todos are readable" on public.todos;
create policy "todos are readable by couple members"
on public.todos for select
using (public.is_couple_member());

drop policy if exists "todo activity links are readable" on public.todo_activity_entries;
create policy "todo activity links are readable by couple members"
on public.todo_activity_entries for select
using (public.is_couple_member());

update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'photos';

drop policy if exists "public can read photos bucket" on storage.objects;
drop policy if exists "couple members can read photos bucket" on storage.objects;
create policy "couple members can read photos bucket"
on storage.objects for select
using (
  bucket_id = 'photos'
  and public.is_couple_member()
);
