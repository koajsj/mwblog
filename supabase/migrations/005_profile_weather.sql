-- 在 profiles 表上加两列，用于在双方之间共享首页"本地天气"
alter table public.profiles
  add column if not exists weather_text text,
  add column if not exists weather_updated_at timestamptz;
