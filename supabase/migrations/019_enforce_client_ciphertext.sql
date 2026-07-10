create or replace function public.is_private_ciphertext(value text)
returns boolean
language sql
immutable
as $$
  select
    value is not null
    and (
      value like 'enc:wc1:%'
      or value like 'enc:v1:%'
    )
$$;

create or replace function public.is_nullable_private_ciphertext(value text)
returns boolean
language sql
immutable
as $$
  select value is null or public.is_private_ciphertext(value)
$$;

alter table public.blog_posts
  drop constraint if exists blog_posts_title_private_check,
  drop constraint if exists blog_posts_excerpt_private_check,
  drop constraint if exists blog_posts_content_private_check;

alter table public.blog_posts
  add constraint blog_posts_title_private_check check (
    public.is_private_ciphertext(title)
    and char_length(title) <= 4096
  ),
  add constraint blog_posts_excerpt_private_check check (
    public.is_nullable_private_ciphertext(excerpt)
    and char_length(coalesce(excerpt, '')) <= 4096
  ),
  add constraint blog_posts_content_private_check check (
    public.is_private_ciphertext(content_markdown)
    and char_length(content_markdown) <= 2000000
  );

alter table public.photos
  drop constraint if exists photos_title_private_check,
  drop constraint if exists photos_caption_private_check;

alter table public.photos
  add constraint photos_title_private_check check (
    public.is_nullable_private_ciphertext(title)
    and char_length(coalesce(title, '')) <= 4096
  ),
  add constraint photos_caption_private_check check (
    public.is_nullable_private_ciphertext(caption)
    and char_length(coalesce(caption, '')) <= 4096
  );

alter table public.life_records
  drop constraint if exists life_records_body_private_check;

alter table public.life_records
  add constraint life_records_body_private_check check (
    public.is_private_ciphertext(body)
    and char_length(body) <= 8192
  );

alter table public.activity_entries
  drop constraint if exists activity_entries_body_private_check;

alter table public.activity_entries
  add constraint activity_entries_body_private_check check (
    public.is_private_ciphertext(body)
    and char_length(body) <= 4096
  );

alter table public.places
  drop constraint if exists places_name_length,
  drop constraint if exists places_note_length;

alter table public.places
  add constraint places_name_length check (
    public.is_private_ciphertext(name)
    and char_length(name) <= 4096
  ),
  add constraint places_note_length check (
    public.is_private_ciphertext(note)
    and char_length(note) <= 4096
  );

alter table public.comments
  drop constraint if exists comments_body_length;

alter table public.comments
  add constraint comments_body_length check (
    public.is_private_ciphertext(body)
    and char_length(body) <= 4096
  );

alter table public.todos
  drop constraint if exists todos_title_check;

alter table public.todos
  add constraint todos_title_check check (
    public.is_private_ciphertext(title)
    and char_length(title) <= 4096
  );

alter table public.profiles
  drop constraint if exists profiles_weather_text_private_check,
  drop constraint if exists profiles_mood_text_private_check,
  drop constraint if exists profiles_doing_text_private_check;

alter table public.profiles
  add constraint profiles_weather_text_private_check check (
    public.is_nullable_private_ciphertext(weather_text)
    and char_length(coalesce(weather_text, '')) <= 4096
  ),
  add constraint profiles_mood_text_private_check check (
    public.is_nullable_private_ciphertext(mood_text)
    and char_length(coalesce(mood_text, '')) <= 4096
  ),
  add constraint profiles_doing_text_private_check check (
    public.is_nullable_private_ciphertext(doing_text)
    and char_length(coalesce(doing_text, '')) <= 4096
  );

drop policy if exists "authenticated users can upload own photos" on storage.objects;
drop policy if exists "owners can update own photos" on storage.objects;
drop policy if exists "authors can upload markdown" on storage.objects;
drop policy if exists "authors can update own markdown" on storage.objects;
