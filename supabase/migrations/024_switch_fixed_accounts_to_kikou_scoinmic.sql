begin;

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

alter table public.profiles disable trigger prevent_private_profile_identity_change;

update public.profiles
set email = case author_key
      when 'white' then 'kikou@our-nest.local'
      when 'brown' then 'scoinmic@our-nest.local'
    end,
    display_name = case author_key
      when 'white' then 'kikou'
      when 'brown' then 'scoinmic'
    end
where author_key in ('white', 'brown');

alter table public.profiles enable trigger prevent_private_profile_identity_change;

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

commit;
