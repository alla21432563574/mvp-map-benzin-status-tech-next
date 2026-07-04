alter table public.stations add column if not exists has_queue boolean;
alter table public.stations add column if not exists external_source text;
alter table public.stations add column if not exists external_key text;
alter table public.stations add column if not exists source_updated_at timestamptz;
alter table public.stations add column if not exists imported_at timestamptz;

create unique index if not exists stations_external_key_idx on public.stations(external_source, external_key)
  where external_source is not null and external_key is not null;

create table if not exists public.scrape_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  found_count integer not null default 0,
  updated_count integer not null default 0,
  created_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists scrape_logs_source_started_idx on public.scrape_logs(source, started_at desc);
alter table public.scrape_logs enable row level security;

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
  select * into existing from public.stations s
  where
    (s.external_source = p_external_source and s.external_key = p_external_key)
    or (lower(regexp_replace(trim(s.name), '\s+', ' ', 'g')) = normalized_name
      and lower(regexp_replace(trim(s.address), '\s+', ' ', 'g')) = normalized_address)
    or (abs(s.latitude - p_latitude) <= 0.00025 and abs(s.longitude - p_longitude) <= 0.00025)
  order by (s.external_source = p_external_source and s.external_key = p_external_key) desc, s.updated_at desc
  limit 1 for update;

  if found then
    if existing.external_source is distinct from p_external_source
      and (p_source_updated_at is null or existing.updated_at > p_source_updated_at) then
      return query select 'skipped'::text, existing.id;
      return;
    end if;
    update public.stations set
      city = coalesce(nullif(p_city, ''), city), name = p_name, address = p_address,
      latitude = coalesce(p_latitude, latitude), longitude = coalesce(p_longitude, longitude), brand = p_brand,
      ai92 = case when p_source_updated_at is null then ai92 else p_ai92 end,
      ai95 = case when p_source_updated_at is null then ai95 else p_ai95 end,
      diesel = case when p_source_updated_at is null then diesel else p_diesel end,
      gas = case when p_source_updated_at is null then gas else p_gas end,
      has_queue = case when p_source_updated_at is null then has_queue else p_has_queue end,
      updated_at = coalesce(p_source_updated_at, updated_at),
      update_source = case when p_source_updated_at is null then update_source else p_external_source end,
      external_source = p_external_source, external_key = p_external_key,
      source_updated_at = coalesce(p_source_updated_at, source_updated_at), imported_at = p_imported_at
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
    p_ai92, p_ai95, p_diesel, p_gas, p_has_queue, coalesce(p_source_updated_at, p_imported_at),
    p_external_source, p_external_source, p_external_key, p_source_updated_at, p_imported_at
  ) returning id into station_id;
  action := 'created';
  return next;
end;
$$;

revoke all on function public.upsert_scraped_station(text, text, text, double precision, double precision, text, boolean, boolean, boolean, boolean, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_scraped_station(text, text, text, double precision, double precision, text, boolean, boolean, boolean, boolean, boolean, text, text, timestamptz, timestamptz) to service_role;
