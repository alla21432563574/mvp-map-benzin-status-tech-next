-- Схема MVP «Есть топливо». Выполните целиком в Supabase SQL Editor.
create extension if not exists "pgcrypto";

create type public.report_status as enum ('pending', 'approved', 'rejected');

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  city text not null default 'Москва',
  name text not null,
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  brand text not null,
  station_status text check (station_status in ('available', 'partial', 'unavailable', 'unknown')),
  ai92 boolean,
  ai95 boolean,
  diesel boolean,
  gas boolean,
  has_queue boolean,
  updated_at timestamptz not null default now(),
  update_source text not null default 'Администратор',
  external_source text,
  external_key text,
  source_updated_at timestamptz,
  imported_at timestamptz,
  is_active boolean not null default true,
  removed_at timestamptz,
  missing_import_runs integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.scrape_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  found_count integer not null default 0,
  updated_count integer not null default 0,
  created_count integer not null default 0,
  unchanged_count integer not null default 0,
  deleted_count integer not null default 0,
  duplicate_count integer not null default 0,
  skipped_count integer not null default 0,
  request_count integer not null default 0,
  reports_found_count integer not null default 0,
  reports_created_count integer not null default 0,
  reports_unchanged_count integer not null default 0,
  reports_skipped_count integer not null default 0,
  reports_error_count integer not null default 0,
  report_request_count integer not null default 0,
  station_status_available_count integer not null default 0,
  station_status_partial_count integer not null default 0,
  station_status_unavailable_count integer not null default 0,
  station_status_unknown_count integer not null default 0,
  reports_errors jsonb,
  fetch_duration_ms integer,
  import_duration_ms integer,
  duration_ms integer,
  run_id uuid,
  error_message text,
  error_details jsonb,
  created_at timestamptz not null default now()
);

create table public.pending_reports (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  ai92 boolean,
  ai95 boolean,
  diesel boolean,
  gas boolean,
  station_status text check (station_status in ('available', 'partial', 'unavailable', 'unknown')),
  has_queue boolean,
  reporter_name text check (char_length(reporter_name) <= 80),
  comment text check (char_length(comment) <= 500),
  source text not null default 'Пользователь',
  telegram_user_id bigint,
  telegram_username text,
  status public.report_status not null default 'pending',
  moderator_note text,
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create index stations_location_idx on public.stations(latitude, longitude);
create index stations_city_idx on public.stations(city);
create unique index stations_external_key_idx on public.stations(external_source, external_key)
  where external_source is not null and external_key is not null;
create index pending_reports_queue_idx on public.pending_reports(status, created_at desc);
create index scrape_logs_source_started_idx on public.scrape_logs(source, started_at desc);

alter table public.stations enable row level security;
alter table public.pending_reports enable row level security;
alter table public.scrape_logs enable row level security;

create policy "Публичное чтение АЗС" on public.stations for select using (true);
-- Отчёты принимаются только через серверный API/service role: так можно
-- rate-limit'ить и дедуплицировать отправку перед записью в очередь.

-- Вызывается серверным API с service-role ключом.
create or replace function public.moderate_report(
  p_report_id uuid,
  p_action public.report_status,
  p_moderator_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.pending_reports%rowtype;
begin
  if p_action not in ('approved', 'rejected') then raise exception 'Invalid moderation action'; end if;
  select * into r from public.pending_reports where id = p_report_id and status = 'pending' for update;
  if not found then raise exception 'Pending report not found'; end if;
  if p_action = 'approved' then
    update public.stations set
      ai92 = coalesce(r.ai92, ai92),
      ai95 = coalesce(r.ai95, ai95),
      diesel = coalesce(r.diesel, diesel),
      gas = coalesce(r.gas, gas),
      station_status = coalesce(r.station_status, station_status),
      has_queue = coalesce(r.has_queue, has_queue),
      updated_at = now(),
      update_source = r.source
    where id = r.station_id;
  end if;
  update public.pending_reports set status = p_action, moderator_note = p_moderator_note,
    moderated_at = now() where id = p_report_id;
end;
$$;

revoke all on function public.moderate_report(uuid, public.report_status, text) from public, anon, authenticated;
grant execute on function public.moderate_report(uuid, public.report_status, text) to service_role;

-- Безопасный импорт публичных данных. Функция вызывается только service-role ключом.
create or replace function public.upsert_scraped_station(
  p_city text,
  p_name text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_brand text,
  p_ai92 boolean,
  p_ai95 boolean,
  p_diesel boolean,
  p_gas boolean,
  p_has_queue boolean,
  p_external_source text,
  p_external_key text,
  p_source_updated_at timestamptz,
  p_imported_at timestamptz
) returns table(action text, station_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.stations%rowtype;
  normalized_name text := lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
  normalized_address text := lower(regexp_replace(trim(p_address), '\s+', ' ', 'g'));
begin
  select * into existing
  from public.stations s
  where
    (s.external_source = p_external_source and s.external_key = p_external_key)
    or (
      lower(regexp_replace(trim(s.name), '\s+', ' ', 'g')) = normalized_name
      and lower(regexp_replace(trim(s.address), '\s+', ' ', 'g')) = normalized_address
    )
    or (
      abs(s.latitude - p_latitude) <= 0.00025
      and abs(s.longitude - p_longitude) <= 0.00025
    )
  order by (s.external_source = p_external_source and s.external_key = p_external_key) desc, s.updated_at desc
  limit 1
  for update;

  if found then
    -- Не заменяем ручную запись, если источник не сообщил время или ручная запись свежее.
    if existing.external_source is distinct from p_external_source
      and (p_source_updated_at is null or existing.updated_at > p_source_updated_at) then
      return query select 'skipped'::text, existing.id;
      return;
    end if;

    update public.stations set
      city = coalesce(nullif(p_city, ''), city),
      name = p_name,
      address = p_address,
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      brand = p_brand,
      ai92 = case when p_source_updated_at is null then ai92 else p_ai92 end,
      ai95 = case when p_source_updated_at is null then ai95 else p_ai95 end,
      diesel = case when p_source_updated_at is null then diesel else p_diesel end,
      gas = case when p_source_updated_at is null then gas else p_gas end,
      has_queue = case when p_source_updated_at is null then has_queue else p_has_queue end,
      updated_at = coalesce(p_source_updated_at, updated_at),
      update_source = case when p_source_updated_at is null then update_source else p_external_source end,
      external_source = p_external_source,
      external_key = p_external_key,
      source_updated_at = coalesce(p_source_updated_at, source_updated_at),
      imported_at = p_imported_at
    where id = existing.id;
    return query select 'updated'::text, existing.id;
    return;
  end if;

  if p_latitude is null or p_longitude is null then
    return query select 'skipped'::text, null::uuid;
    return;
  end if;

  insert into public.stations (
    city, name, address, latitude, longitude, brand, ai92, ai95, diesel, gas, has_queue,
    updated_at, update_source, external_source, external_key, source_updated_at, imported_at
  ) values (
    coalesce(nullif(p_city, ''), 'Не указан'), p_name, p_address, p_latitude, p_longitude, p_brand,
    p_ai92, p_ai95, p_diesel, p_gas, p_has_queue,
    coalesce(p_source_updated_at, p_imported_at), p_external_source, p_external_source,
    p_external_key, p_source_updated_at, p_imported_at
  ) returning id into station_id;
  action := 'created';
  return next;
end;
$$;

revoke all on function public.upsert_scraped_station(text, text, text, double precision, double precision, text, boolean, boolean, boolean, boolean, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_scraped_station(text, text, text, double precision, double precision, text, boolean, boolean, boolean, boolean, boolean, text, text, timestamptz, timestamptz) to service_role;

create table if not exists public.station_reports (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  external_id text not null,
  status text not null check (status in ('available', 'partial', 'unavailable', 'unknown')),
  fuel_type text,
  fuel_types text[],
  queue integer check (queue is null or queue >= 0),
  queue_text text,
  labels jsonb,
  raw_text text,
  queue_status text,
  partial_reason text,
  is_corrected boolean,
  comment text,
  is_on_site boolean,
  is_reliable boolean,
  source text not null,
  is_counted boolean,
  created_at timestamptz not null,
  imported_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists station_reports_station_created_idx on public.station_reports(station_id, created_at desc);
create index if not exists station_reports_labels_gin_idx on public.station_reports using gin (labels);
alter table public.station_reports enable row level security;
create policy "Public station reports are readable" on public.station_reports for select using (true);
grant select on table public.station_reports to anon, authenticated;

create or replace view public.latest_station_reports as
select distinct on (station_id)
  station_id,
  status,
  created_at,
  source
from public.station_reports
where is_counted is distinct from false
order by station_id, created_at desc;

grant select on public.latest_station_reports to anon, authenticated, service_role;

create table if not exists public.station_report_sync (
  source text not null,
  station_external_key text not null,
  last_report_at timestamptz not null,
  checked_at timestamptz not null default now(),
  primary key (source, station_external_key)
);
alter table public.station_report_sync enable row level security;

insert into public.stations (city, name, address, latitude, longitude, brand, ai92, ai95, diesel, gas, update_source) values
('Москва', 'АЗС Луговая', 'ул. Луговая, 18', 55.7557, 37.6175, 'Энергия', true, true, true, false, 'Оператор АЗС'),
('Москва', 'АЗС Садовое кольцо', 'ул. Земляной Вал, 42', 55.7507, 37.6592, 'Пульс', true, false, true, null, 'Пользователь'),
('Москва', 'АЗС Северная', 'Ленинградский проспект, 35', 55.7874, 37.5579, 'Энергия', false, false, true, false, 'Пользователь'),
('Москва', 'АЗС Речная', 'Берсеневская наб., 6', 55.7404, 37.6091, 'Маршрут', false, false, false, false, 'Оператор АЗС'),
('Москва', 'АЗС Восток', 'ш. Энтузиастов, 12', 55.7471, 37.6928, 'Пульс', true, true, false, true, 'Пользователь');
