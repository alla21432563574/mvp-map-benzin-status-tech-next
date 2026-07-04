-- Выполните эту миграцию, если базовая schema.sql уже была применена ранее.
alter table public.stations add column if not exists city text not null default 'Москва';
alter table public.pending_reports add column if not exists telegram_user_id bigint;
alter table public.pending_reports add column if not exists telegram_username text;
create index if not exists stations_city_idx on public.stations(city);
