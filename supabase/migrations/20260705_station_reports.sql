-- Публичные отметки водителей. Внешний id отметки уникален в рамках источника,
-- поэтому повторный запуск scraper не создаёт копии истории.

create table if not exists public.station_reports (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  external_id text not null,
  status text not null check (status in ('available', 'partial', 'unavailable', 'unknown')),
  fuel_type text,
  fuel_types text[],
  queue integer check (queue is null or queue >= 0),
  queue_text text,
  comment text,
  is_on_site boolean,
  source text not null,
  is_counted boolean,
  created_at timestamptz not null,
  imported_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists station_reports_station_created_idx
  on public.station_reports(station_id, created_at desc);
create index if not exists station_reports_source_created_idx
  on public.station_reports(source, created_at desc);
create index if not exists station_reports_recent_counted_idx
  on public.station_reports(station_id, created_at desc)
  where is_counted is distinct from false;

alter table public.station_reports enable row level security;

drop policy if exists "Public station reports are readable" on public.station_reports;
create policy "Public station reports are readable"
  on public.station_reports for select
  using (true);

alter table public.scrape_logs add column if not exists reports_found_count integer not null default 0;
alter table public.scrape_logs add column if not exists reports_created_count integer not null default 0;
alter table public.scrape_logs add column if not exists reports_unchanged_count integer not null default 0;
alter table public.scrape_logs add column if not exists report_request_count integer not null default 0;

create or replace function public.import_station_reports(p_source text, p_reports jsonb)
returns table(
  found_count integer,
  created_count integer,
  unchanged_count integer,
  missing_station_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found integer := 0;
  v_created integer := 0;
  v_missing integer := 0;
begin
  if nullif(trim(p_source), '') is null then raise exception 'source is required'; end if;
  if jsonb_typeof(coalesce(p_reports, '[]'::jsonb)) <> 'array' then
    raise exception 'p_reports must be a JSON array';
  end if;

  create temporary table tmp_incoming_reports on commit drop as
  select distinct on (nullif(trim(row.external_id), ''))
    nullif(trim(row.external_id), '') as external_id,
    nullif(trim(row.station_external_key), '') as station_external_key,
    case row.status
      when 'available' then 'available'
      when 'partial' then 'partial'
      when 'unavailable' then 'unavailable'
      else 'unknown'
    end as status,
    nullif(trim(row.fuel_type), '') as fuel_type,
    row.fuel_types,
    case when row.queue is null then null else greatest(row.queue, 0) end as queue,
    nullif(trim(row.queue_text), '') as queue_text,
    nullif(trim(row.comment), '') as comment,
    row.is_on_site,
    row.is_counted,
    row.created_at
  from jsonb_to_recordset(coalesce(p_reports, '[]'::jsonb)) as row(
    external_id text,
    station_external_key text,
    status text,
    fuel_type text,
    fuel_types text[],
    queue integer,
    queue_text text,
    comment text,
    is_on_site boolean,
    is_counted boolean,
    created_at timestamptz
  )
  where nullif(trim(row.external_id), '') is not null
    and nullif(trim(row.station_external_key), '') is not null
    and row.created_at is not null
  order by nullif(trim(row.external_id), ''), row.created_at desc;

  select count(*) into v_found from tmp_incoming_reports;

  select count(*) into v_missing
  from tmp_incoming_reports incoming
  where not exists (
    select 1 from public.stations station
    where station.external_source = p_source
      and station.external_key = incoming.station_external_key
  );

  insert into public.station_reports (
    station_id, external_id, status, fuel_type, fuel_types, queue, queue_text,
    comment, is_on_site, source, is_counted, created_at, imported_at
  )
  select station.id, incoming.external_id, incoming.status, incoming.fuel_type,
    incoming.fuel_types, incoming.queue, incoming.queue_text, incoming.comment,
    incoming.is_on_site, p_source, incoming.is_counted, incoming.created_at, now()
  from tmp_incoming_reports incoming
  join public.stations station
    on station.external_source = p_source
   and station.external_key = incoming.station_external_key
  on conflict (source, external_id) do nothing;
  get diagnostics v_created = row_count;

  return query select v_found, v_created,
    greatest(v_found - v_created - v_missing, 0), v_missing;
end;
$$;

revoke all on table public.station_reports from anon, authenticated;
grant select on table public.station_reports to anon, authenticated;
revoke all on function public.import_station_reports(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_station_reports(text, jsonb) to service_role;
