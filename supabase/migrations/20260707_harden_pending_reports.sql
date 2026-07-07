alter table public.pending_reports
  add column if not exists station_status text
    check (station_status in ('available', 'partial', 'unavailable', 'unknown')),
  add column if not exists has_queue boolean;

drop policy if exists "Публичная отправка сообщений" on public.pending_reports;

create index if not exists pending_reports_recent_station_idx
  on public.pending_reports(station_id, created_at desc);

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
