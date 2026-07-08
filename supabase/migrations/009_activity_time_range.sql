alter table public.activity_entries
add column if not exists start_time time without time zone,
add column if not exists end_time time without time zone;

update public.activity_entries
set start_time = case period
  when 'morning' then time '05:00'
  when 'forenoon' then time '08:00'
  when 'noon' then time '11:00'
  when 'afternoon' then time '14:00'
  when 'dusk' then time '17:00'
  when 'evening' then time '19:00'
  when 'midnight' then time '23:00'
  else time '00:00'
end
where start_time is null;

update public.activity_entries
set end_time = (start_time + (minutes * interval '1 minute'))::time
where end_time is null
  and start_time is not null;

alter table public.activity_entries
drop constraint if exists activity_entries_minutes_check;

alter table public.activity_entries
add constraint activity_entries_minutes_check check (minutes >= 1 and minutes <= 1440);

create index if not exists activity_entries_owner_date_start_idx
on public.activity_entries (owner_id, activity_on desc, start_time, created_at);
