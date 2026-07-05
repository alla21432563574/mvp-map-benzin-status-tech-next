alter table public.stations
  add column if not exists station_status text
  check (station_status in ('available', 'partial', 'unavailable', 'unknown'));

create or replace function public.update_station_statuses(p_source text, p_statuses jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if nullif(trim(p_source), '') is null then raise exception 'source is required'; end if;
  if jsonb_typeof(coalesce(p_statuses, '[]'::jsonb)) <> 'array' then
    raise exception 'p_statuses must be a JSON array';
  end if;

  create temporary table tmp_station_statuses on commit drop as
  select distinct on (nullif(trim(row.external_key), ''))
    nullif(trim(row.external_key), '') as external_key,
    case row.station_status
      when 'available' then 'available'
      when 'partial' then 'partial'
      when 'unavailable' then 'unavailable'
      else 'unknown'
    end as station_status,
    row.source_updated_at
  from jsonb_to_recordset(coalesce(p_statuses, '[]'::jsonb)) as row(
    external_key text,
    station_status text,
    source_updated_at timestamptz
  )
  where nullif(trim(row.external_key), '') is not null
  order by nullif(trim(row.external_key), ''), row.source_updated_at desc nulls last;

  update public.stations station set
    station_status = incoming.station_status,
    updated_at = case
      when station.station_status is distinct from incoming.station_status
       and incoming.source_updated_at is not null
      then greatest(station.updated_at, incoming.source_updated_at)
      else station.updated_at
    end,
    update_source = case
      when station.station_status is distinct from incoming.station_status
      then p_source
      else station.update_source
    end
  from tmp_station_statuses incoming
  where station.external_source = p_source
    and station.external_key = incoming.external_key
    and (
      station.source_updated_at is null
      or incoming.source_updated_at is null
      or incoming.source_updated_at >= station.source_updated_at
    )
    and station.station_status is distinct from incoming.station_status;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.update_station_statuses(text, jsonb) from public, anon, authenticated;
grant execute on function public.update_station_statuses(text, jsonb) to service_role;
