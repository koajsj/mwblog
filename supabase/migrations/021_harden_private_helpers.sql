-- Keep the target-existence helper usable by the comments policy without
-- exposing a direct anonymous existence oracle through PostgREST RPC.
create or replace function public.comment_target_exists(target_type text, target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_couple_member()
    and case
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

revoke all on function public.comment_target_exists(text, uuid) from public, anon;
grant execute on function public.comment_target_exists(text, uuid) to authenticated;

-- Polymorphic comments cannot use a normal foreign key. Keep cleanup in the
-- same transaction as the target delete so direct Supabase deletes do not
-- leave encrypted orphan rows behind.
create or replace function public.delete_private_target_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.comments
  where target_type = tg_argv[0]
    and target_id = old.id
    and space_id = public.private_space_id();
  return old;
end;
$$;

revoke all on function public.delete_private_target_comments() from public, anon, authenticated;

drop trigger if exists delete_blog_post_comments on public.blog_posts;
create trigger delete_blog_post_comments
after delete on public.blog_posts
for each row execute function public.delete_private_target_comments('blog');

drop trigger if exists delete_life_record_comments on public.life_records;
create trigger delete_life_record_comments
after delete on public.life_records
for each row execute function public.delete_private_target_comments('record');
