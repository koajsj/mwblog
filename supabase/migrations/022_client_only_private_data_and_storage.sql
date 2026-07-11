-- Final hardening: new private content must use browser-side ciphertext.
-- Existing legacy rows can remain until migrated because these constraints are
-- NOT VALID, but all future inserts and updates must satisfy them.
create or replace function public.is_client_private_ciphertext(value text)
returns boolean
language sql
immutable
as $$
  select value is not null and value ~ '^enc:wc1:[A-Za-z0-9_-]+$'
$$;

create or replace function public.is_nullable_client_private_ciphertext(value text)
returns boolean
language sql
immutable
as $$
  select value is null or public.is_client_private_ciphertext(value)
$$;

alter table public.blog_posts
  drop constraint if exists blog_posts_title_private_check,
  drop constraint if exists blog_posts_excerpt_private_check,
  drop constraint if exists blog_posts_content_private_check,
  add constraint blog_posts_title_private_check check (
    public.is_client_private_ciphertext(title) and char_length(title) <= 4096
  ) not valid,
  add constraint blog_posts_excerpt_private_check check (
    public.is_nullable_client_private_ciphertext(excerpt) and char_length(coalesce(excerpt, '')) <= 4096
  ) not valid,
  add constraint blog_posts_content_private_check check (
    public.is_client_private_ciphertext(content_markdown) and char_length(content_markdown) <= 2000000
  ) not valid;

alter table public.photos
  drop constraint if exists photos_title_private_check,
  drop constraint if exists photos_caption_private_check,
  add constraint photos_title_private_check check (
    public.is_nullable_client_private_ciphertext(title) and char_length(coalesce(title, '')) <= 4096
  ) not valid,
  add constraint photos_caption_private_check check (
    public.is_nullable_client_private_ciphertext(caption) and char_length(coalesce(caption, '')) <= 4096
  ) not valid;

alter table public.life_records
  drop constraint if exists life_records_body_private_check,
  add constraint life_records_body_private_check check (
    public.is_client_private_ciphertext(body) and char_length(body) <= 8192
  ) not valid;

alter table public.activity_entries
  drop constraint if exists activity_entries_body_private_check,
  add constraint activity_entries_body_private_check check (
    public.is_client_private_ciphertext(body) and char_length(body) <= 4096
  ) not valid;

alter table public.places
  drop constraint if exists places_name_length,
  drop constraint if exists places_note_length,
  add constraint places_name_length check (
    public.is_client_private_ciphertext(name) and char_length(name) <= 4096
  ) not valid,
  add constraint places_note_length check (
    public.is_client_private_ciphertext(note) and char_length(note) <= 4096
  ) not valid;

alter table public.comments
  drop constraint if exists comments_body_length,
  add constraint comments_body_length check (
    public.is_client_private_ciphertext(body) and char_length(body) <= 4096
  ) not valid;

alter table public.todos
  drop constraint if exists todos_title_check,
  add constraint todos_title_check check (
    public.is_client_private_ciphertext(title) and char_length(title) <= 4096
  ) not valid;

alter table public.profiles
  drop constraint if exists profiles_weather_text_private_check,
  drop constraint if exists profiles_mood_text_private_check,
  drop constraint if exists profiles_doing_text_private_check,
  add constraint profiles_weather_text_private_check check (
    public.is_nullable_client_private_ciphertext(weather_text) and char_length(coalesce(weather_text, '')) <= 4096
  ) not valid,
  add constraint profiles_mood_text_private_check check (
    public.is_nullable_client_private_ciphertext(mood_text) and char_length(coalesce(mood_text, '')) <= 4096
  ) not valid,
  add constraint profiles_doing_text_private_check check (
    public.is_nullable_client_private_ciphertext(doing_text) and char_length(coalesce(doing_text, '')) <= 4096
  ) not valid;

update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/octet-stream']
where id = 'photos';

update storage.buckets
set public = false,
    file_size_limit = 1048576,
    allowed_mime_types = array['text/plain', 'text/markdown']
where id = 'blog-markdown';

drop policy if exists "public can read photos bucket" on storage.objects;
drop policy if exists "couple members can read photos bucket" on storage.objects;
drop policy if exists "authenticated users can upload own photos" on storage.objects;
drop policy if exists "owners can update own photos" on storage.objects;
drop policy if exists "owners can delete own photos" on storage.objects;
drop policy if exists "authors can upload markdown" on storage.objects;
drop policy if exists "authors can read own markdown" on storage.objects;
drop policy if exists "authors can update own markdown" on storage.objects;
drop policy if exists "couple members can read committed photos bucket" on storage.objects;
drop policy if exists "couple members can read committed markdown bucket" on storage.objects;

create policy "couple members can read committed photos bucket"
on storage.objects for select
using (
  bucket_id = 'photos'
  and public.is_couple_member()
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.photos
      where photos.storage_path = storage.objects.name
        and photos.space_id = public.private_space_id()
    )
  )
);

create policy "couple members can read committed markdown bucket"
on storage.objects for select
using (
  bucket_id = 'blog-markdown'
  and public.is_couple_member()
  and exists (
    select 1
    from public.blog_posts
    where blog_posts.storage_path = storage.objects.name
      and blog_posts.space_id = public.private_space_id()
  )
);
