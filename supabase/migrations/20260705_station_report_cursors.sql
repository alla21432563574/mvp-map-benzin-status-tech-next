-- Отдельный курсор на каждую АЗС позволяет ограничивать число detail-запросов,
-- не теряя станции, которые не поместились в один запуск.
create table if not exists public.station_report_sync (
  source text not null,
  station_external_key text not null,
  last_report_at timestamptz not null,
  checked_at timestamptz not null default now(),
  primary key (source, station_external_key)
);
alter table public.station_report_sync enable row level security;

create or replace function public.sync_station_report_cursors(p_source text, p_stations jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.station_report_sync(source, station_external_key, last_report_at, checked_at)
  select p_source, row.station_external_key, row.last_report_at, now()
  from jsonb_to_recordset(coalesce(p_stations, '[]'::jsonb)) as row(
    station_external_key text,
    last_report_at timestamptz
  )
  where nullif(trim(row.station_external_key), '') is not null and row.last_report_at is not null
  on conflict (source, station_external_key) do update set
    last_report_at = greatest(public.station_report_sync.last_report_at, excluded.last_report_at),
    checked_at = excluded.checked_at;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on table public.station_report_sync from public, anon, authenticated;
revoke all on function public.sync_station_report_cursors(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_station_report_cursors(text, jsonb) to service_role;
