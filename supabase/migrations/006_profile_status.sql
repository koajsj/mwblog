-- 在 profiles 上加 mood / doing 字段，让双方互相看见对方的当日状态
-- 用 _date (text 'YYYY-MM-DD') 实现按天过期，和原 localStorage 行为一致
alter table public.profiles
  add column if not exists mood_text text,
  add column if not exists mood_date text,
  add column if not exists doing_text text,
  add column if not exists doing_date text;
