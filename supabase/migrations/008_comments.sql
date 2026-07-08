-- 评论：blog 文章 + 生活记录共用同一张表，按 target_type 区分
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint comments_target_type_check check (target_type in ('blog', 'record')),
  constraint comments_body_length check (char_length(body) between 1 and 500)
);

create index if not exists comments_target_idx
on public.comments (target_type, target_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments are readable" on public.comments;
create policy "comments are readable"
on public.comments for select
using (true);

drop policy if exists "users can insert their own comments" on public.comments;
create policy "users can insert their own comments"
on public.comments for insert
with check (auth.uid() = author_id);

drop policy if exists "authors can delete their own comments" on public.comments;
create policy "authors can delete their own comments"
on public.comments for delete
using (auth.uid() = author_id);
