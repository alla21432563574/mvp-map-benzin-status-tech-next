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
