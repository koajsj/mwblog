-- 记住每个用户上一次更新天气时的位置坐标，让对方设备能用这些坐标实时拉天气
alter table public.profiles
  add column if not exists weather_lat double precision,
  add column if not exists weather_lng double precision,
  add column if not exists weather_label text;
