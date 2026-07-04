create index if not exists scrape_logs_started_at_idx
  on public.scrape_logs(started_at);

create or replace function public.cleanup_scrape_logs(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.scrape_logs
  where started_at < now() - make_interval(days => greatest(1, least(p_retention_days, 365)));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_scrape_logs(integer) from public, anon, authenticated;
grant execute on function public.cleanup_scrape_logs(integer) to service_role;
