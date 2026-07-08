alter table public.places
  drop constraint if exists places_name_length,
  drop constraint if exists places_note_length;

alter table public.places
  add constraint places_name_length check (
    (name like 'enc:v1:%' and char_length(name) <= 2048)
    or char_length(name) between 1 and 32
  ),
  add constraint places_note_length check (
    (note like 'enc:v1:%' and char_length(note) <= 4096)
    or char_length(note) between 1 and 140
  );

alter table public.comments
  drop constraint if exists comments_body_length;

alter table public.comments
  add constraint comments_body_length check (
    (body like 'enc:v1:%' and char_length(body) <= 4096)
    or char_length(body) between 1 and 500
  );

alter table public.todos
  drop constraint if exists todos_title_check;

alter table public.todos
  add constraint todos_title_check check (
    (title like 'enc:v1:%' and char_length(title) <= 2048)
    or char_length(trim(title)) between 1 and 120
  );

update public.profiles
set weather_lat = null,
    weather_lng = null
where weather_lat is not null
   or weather_lng is not null;
