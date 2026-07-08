create extension if not exists pgcrypto;

do $$
begin
  create type public.author_key as enum ('white', 'brown');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  author_key public.author_key not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  content_markdown text not null,
  storage_path text,
  author_id uuid not null references public.profiles(id) on delete cascade,
  tags text[] not null default '{}',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  caption text,
  taken_on date,
  storage_path text not null unique,
  mime_type text,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_blog_posts_updated_at on public.blog_posts;
create trigger touch_blog_posts_updated_at
before update on public.blog_posts
for each row execute function public.touch_updated_at();

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
  selected_author := coalesce(new.raw_user_meta_data ->> 'author_key', 'white')::public.author_key;
  selected_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  insert into public.profiles (id, email, author_key, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    selected_author,
    coalesce(selected_name, case when selected_author = 'brown' then '棕狗' else '白狗' end)
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.blog_posts enable row level security;
alter table public.photos enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
on public.profiles for select
using (true);

drop policy if exists "profiles can be updated by owner" on public.profiles;
create policy "profiles can be updated by owner"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "posts are readable" on public.blog_posts;
create policy "posts are readable"
on public.blog_posts for select
using (true);

drop policy if exists "authors can insert posts" on public.blog_posts;
create policy "authors can insert posts"
on public.blog_posts for insert
with check (auth.uid() = author_id);

drop policy if exists "authors can update posts" on public.blog_posts;
create policy "authors can update posts"
on public.blog_posts for update
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

drop policy if exists "authors can delete posts" on public.blog_posts;
create policy "authors can delete posts"
on public.blog_posts for delete
using (auth.uid() = author_id);

drop policy if exists "photos are readable" on public.photos;
create policy "photos are readable"
on public.photos for select
using (true);

drop policy if exists "owners can insert photos" on public.photos;
create policy "owners can insert photos"
on public.photos for insert
with check (auth.uid() = owner_id);

drop policy if exists "owners can update photos" on public.photos;
create policy "owners can update photos"
on public.photos for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners can delete photos" on public.photos;
create policy "owners can delete photos"
on public.photos for delete
using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', true, 10485760)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
values ('blog-markdown', 'blog-markdown', false, 1048576)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "public can read photos bucket" on storage.objects;
create policy "public can read photos bucket"
on storage.objects for select
using (bucket_id = 'photos');

drop policy if exists "authenticated users can upload own photos" on storage.objects;
create policy "authenticated users can upload own photos"
on storage.objects for insert
with check (
  bucket_id = 'photos'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners can update own photos" on storage.objects;
create policy "owners can update own photos"
on storage.objects for update
using (
  bucket_id = 'photos'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'photos'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners can delete own photos" on storage.objects;
create policy "owners can delete own photos"
on storage.objects for delete
using (
  bucket_id = 'photos'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authors can upload markdown" on storage.objects;
create policy "authors can upload markdown"
on storage.objects for insert
with check (
  bucket_id = 'blog-markdown'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authors can read own markdown" on storage.objects;
create policy "authors can read own markdown"
on storage.objects for select
using (
  bucket_id = 'blog-markdown'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authors can update own markdown" on storage.objects;
create policy "authors can update own markdown"
on storage.objects for update
using (
  bucket_id = 'blog-markdown'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'blog-markdown'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);
