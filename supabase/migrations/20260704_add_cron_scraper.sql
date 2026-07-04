create table if not exists public.scrape_locks (
  source text primary key,
  token uuid not null,
  locked_at timestamptz not null default now(),
  locked_until timestamptz not null
);

alter table public.scrape_locks enable row level security;

create or replace function public.try_acquire_scrape_lock(
  p_source text,
  p_token uuid,
  p_lease_seconds integer default 600
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  insert into public.scrape_locks(source, token, locked_at, locked_until)
  values (p_source, p_token, now(), now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600))))
  on conflict (source) do update set
    token = excluded.token,
    locked_at = excluded.locked_at,
    locked_until = excluded.locked_until
  where public.scrape_locks.locked_until <= now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.release_scrape_lock(p_source text, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  delete from public.scrape_locks where source = p_source and token = p_token;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.bulk_upsert_scraped_stations(p_stations jsonb)
returns table(found_count integer, created_count integer, updated_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_action text;
begin
  found_count := coalesce(jsonb_array_length(p_stations), 0);
  created_count := 0;
  updated_count := 0;
  skipped_count := 0;

  for item in select value from jsonb_array_elements(coalesce(p_stations, '[]'::jsonb)) loop
    select result.action into item_action
    from public.upsert_scraped_station(
      item->>'city', item->>'name', item->>'address',
      (item->>'latitude')::double precision, (item->>'longitude')::double precision,
      item->>'brand', (item->>'ai92')::boolean, (item->>'ai95')::boolean,
      (item->>'diesel')::boolean, (item->>'gas')::boolean, (item->>'hasQueue')::boolean,
      item->>'externalSource', item->>'externalKey',
      nullif(item->>'sourceUpdatedAt', '')::timestamptz,
      (item->>'importedAt')::timestamptz
    ) result;

    if item_action = 'created' then created_count := created_count + 1;
    elsif item_action = 'updated' then updated_count := updated_count + 1;
    else skipped_count := skipped_count + 1;
    end if;
  end loop;
  return next;
end;
$$;

revoke all on function public.try_acquire_scrape_lock(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_scrape_lock(text, uuid) from public, anon, authenticated;
revoke all on function public.bulk_upsert_scraped_stations(jsonb) from public, anon, authenticated;
grant execute on function public.try_acquire_scrape_lock(text, uuid, integer) to service_role;
grant execute on function public.release_scrape_lock(text, uuid) to service_role;
grant execute on function public.bulk_upsert_scraped_stations(jsonb) to service_role;
