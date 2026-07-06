alter table public.station_reports add column if not exists labels jsonb;
alter table public.station_reports add column if not exists raw_text text;
alter table public.station_reports add column if not exists queue_status text;
alter table public.station_reports add column if not exists partial_reason text;
alter table public.station_reports add column if not exists is_corrected boolean;
alter table public.station_reports add column if not exists is_reliable boolean;

create index if not exists station_reports_labels_gin_idx
  on public.station_reports using gin (labels);

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
  v_touched integer := 0;
  v_existing integer := 0;
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
    case
      when row.labels is null then null
      when jsonb_typeof(row.labels) = 'array' then row.labels
      else null
    end as labels,
    nullif(trim(row.raw_text), '') as raw_text,
    nullif(trim(row.queue_status), '') as queue_status,
    nullif(trim(row.partial_reason), '') as partial_reason,
    row.is_corrected,
    nullif(trim(row.comment), '') as comment,
    row.is_on_site,
    row.is_reliable,
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
    labels jsonb,
    raw_text text,
    queue_status text,
    partial_reason text,
    is_corrected boolean,
    comment text,
    is_on_site boolean,
    is_reliable boolean,
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

  select count(*) into v_existing
  from tmp_incoming_reports incoming
  where exists (
    select 1 from public.station_reports report
    where report.source = p_source
      and report.external_id = incoming.external_id
  );

  insert into public.station_reports (
    station_id, external_id, status, fuel_type, fuel_types, queue, queue_text,
    labels, raw_text, queue_status, partial_reason, is_corrected,
    comment, is_on_site, is_reliable, source, is_counted, created_at, imported_at
  )
  select station.id, incoming.external_id, incoming.status, incoming.fuel_type,
    incoming.fuel_types, incoming.queue, incoming.queue_text,
    incoming.labels, incoming.raw_text, incoming.queue_status, incoming.partial_reason, incoming.is_corrected,
    incoming.comment, incoming.is_on_site, incoming.is_reliable,
    p_source, incoming.is_counted, incoming.created_at, now()
  from tmp_incoming_reports incoming
  join public.stations station
    on station.external_source = p_source
   and station.external_key = incoming.station_external_key
  on conflict (source, external_id) do update set
    status = excluded.status,
    fuel_type = excluded.fuel_type,
    fuel_types = excluded.fuel_types,
    queue = excluded.queue,
    queue_text = excluded.queue_text,
    labels = excluded.labels,
    raw_text = excluded.raw_text,
    queue_status = excluded.queue_status,
    partial_reason = excluded.partial_reason,
    is_corrected = excluded.is_corrected,
    comment = excluded.comment,
    is_on_site = excluded.is_on_site,
    is_reliable = excluded.is_reliable,
    is_counted = excluded.is_counted,
    imported_at = now()
  where public.station_reports.status is distinct from excluded.status
     or public.station_reports.fuel_type is distinct from excluded.fuel_type
     or public.station_reports.fuel_types is distinct from excluded.fuel_types
     or public.station_reports.queue is distinct from excluded.queue
     or public.station_reports.queue_text is distinct from excluded.queue_text
     or public.station_reports.labels is distinct from excluded.labels
     or public.station_reports.raw_text is distinct from excluded.raw_text
     or public.station_reports.queue_status is distinct from excluded.queue_status
     or public.station_reports.partial_reason is distinct from excluded.partial_reason
     or public.station_reports.is_corrected is distinct from excluded.is_corrected
     or public.station_reports.comment is distinct from excluded.comment
     or public.station_reports.is_on_site is distinct from excluded.is_on_site
     or public.station_reports.is_reliable is distinct from excluded.is_reliable
     or public.station_reports.is_counted is distinct from excluded.is_counted;
  get diagnostics v_touched = row_count;

  v_created := greatest(v_found - v_missing - v_existing, 0);

  return query select v_found, v_created,
    greatest(v_found - v_touched - v_missing, 0), v_missing;
end;
$$;

revoke all on function public.import_station_reports(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_station_reports(text, jsonb) to service_role;
