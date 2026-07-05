-- Двухфазный импорт: пакеты сначала попадают в staging, затем весь снимок
-- публикуется одной транзакцией. Внешний id является каноническим ключом;
-- координаты используются только для дедупликации входного снимка.

alter table public.stations add column if not exists is_active boolean not null default true;
alter table public.stations add column if not exists removed_at timestamptz;
alter table public.stations add column if not exists missing_import_runs integer not null default 0;

alter table public.scrape_logs add column if not exists run_id uuid;
alter table public.scrape_logs add column if not exists unchanged_count integer not null default 0;
alter table public.scrape_logs add column if not exists deleted_count integer not null default 0;
alter table public.scrape_logs add column if not exists duplicate_count integer not null default 0;
alter table public.scrape_logs add column if not exists skipped_count integer not null default 0;
alter table public.scrape_logs add column if not exists request_count integer not null default 0;
alter table public.scrape_logs add column if not exists fetch_duration_ms integer;
alter table public.scrape_logs add column if not exists import_duration_ms integer;
alter table public.scrape_logs add column if not exists duration_ms integer;
alter table public.scrape_logs add column if not exists error_details jsonb;

create index if not exists stations_active_longitude_latitude_idx
  on public.stations(longitude, latitude) where is_active;
create index if not exists stations_source_active_idx
  on public.stations(external_source, is_active);

create table if not exists public.station_import_staging (
  run_id uuid not null,
  source text not null,
  external_key text not null,
  city text not null,
  name text not null,
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  brand text not null,
  ai92 boolean,
  ai95 boolean,
  diesel boolean,
  gas boolean,
  has_queue boolean,
  source_updated_at timestamptz,
  staged_at timestamptz not null default now(),
  primary key (run_id, source, external_key)
);

create index if not exists station_import_staging_run_idx
  on public.station_import_staging(run_id, source);

alter table public.station_import_staging enable row level security;

create table if not exists public.station_import_results (
  run_id uuid primary key,
  source text not null,
  found_count integer not null,
  staged_count integer not null,
  created_count integer not null,
  updated_count integer not null,
  unchanged_count integer not null,
  deleted_count integer not null,
  duplicate_count integer not null,
  completed_at timestamptz not null default now()
);

alter table public.station_import_results enable row level security;

create or replace function public.stage_scraped_stations(p_run_id uuid, p_stations jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if p_run_id is null then raise exception 'run_id is required'; end if;
  if jsonb_typeof(coalesce(p_stations, '[]'::jsonb)) <> 'array' then
    raise exception 'p_stations must be a JSON array';
  end if;

  delete from public.station_import_staging where staged_at < now() - interval '24 hours';

  insert into public.station_import_staging (
    run_id, source, external_key, city, name, address, latitude, longitude, brand,
    ai92, ai95, diesel, gas, has_queue, source_updated_at, staged_at
  )
  select
    p_run_id,
    nullif(trim(row.external_source), ''),
    nullif(trim(row.external_key), ''),
    coalesce(nullif(trim(row.city), ''), 'Не указан'),
    coalesce(nullif(trim(row.name), ''), 'АЗС ' || row.external_key),
    coalesce(nullif(trim(row.address), ''), 'Точка ' || row.latitude || ', ' || row.longitude),
    row.latitude,
    row.longitude,
    coalesce(nullif(trim(row.brand), ''), nullif(trim(row.name), ''), 'АЗС'),
    row.ai92,
    row.ai95,
    row.diesel,
    row.gas,
    row.has_queue,
    row.source_updated_at,
    now()
  from jsonb_to_recordset(coalesce(p_stations, '[]'::jsonb)) as row(
    external_source text,
    external_key text,
    city text,
    name text,
    address text,
    latitude double precision,
    longitude double precision,
    brand text,
    ai92 boolean,
    ai95 boolean,
    diesel boolean,
    gas boolean,
    has_queue boolean,
    source_updated_at timestamptz
  )
  where nullif(trim(row.external_source), '') is not null
    and nullif(trim(row.external_key), '') is not null
    and row.latitude between -90 and 90
    and row.longitude between -180 and 180
  on conflict (run_id, source, external_key) do update set
    city = excluded.city,
    name = excluded.name,
    address = excluded.address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    brand = excluded.brand,
    ai92 = excluded.ai92,
    ai95 = excluded.ai95,
    diesel = excluded.diesel,
    gas = excluded.gas,
    has_queue = excluded.has_queue,
    source_updated_at = case
      when public.station_import_staging.source_updated_at is null then excluded.source_updated_at
      when excluded.source_updated_at is null then public.station_import_staging.source_updated_at
      else greatest(public.station_import_staging.source_updated_at, excluded.source_updated_at)
    end,
    staged_at = excluded.staged_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.discard_scraped_station_import(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.station_import_staging where run_id = p_run_id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.finalize_scraped_station_import(
  p_run_id uuid,
  p_source text,
  p_found_count integer,
  p_allow_deactivate boolean default false,
  p_min_snapshot_ratio double precision default 0.85,
  p_missing_runs_before_deactivate integer default 3
) returns table(
  found_count integer,
  staged_count integer,
  created_count integer,
  updated_count integer,
  unchanged_count integer,
  deleted_count integer,
  duplicate_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staged_count integer := 0;
  v_candidate_count integer := 0;
  v_existing_active_count integer := 0;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_deleted_count integer := 0;
  v_duplicate_count integer := 0;
  v_finalized_at timestamptz := clock_timestamp();
  v_min_ratio double precision := greatest(0.5, least(coalesce(p_min_snapshot_ratio, 0.85), 1));
  v_missing_threshold integer := greatest(1, least(coalesce(p_missing_runs_before_deactivate, 3), 20));
begin
  if p_run_id is null or nullif(trim(p_source), '') is null then
    raise exception 'run_id and source are required';
  end if;

  -- Сериализует финализацию одного источника даже при ошибке внешнего lock.
  perform pg_advisory_xact_lock(hashtextextended(p_source, 0));

  -- Повтор RPC после сетевого таймаута безопасен: результат уже завершённой
  -- транзакции возвращается без повторного изменения stations.
  if exists (select 1 from public.station_import_results result where result.run_id = p_run_id) then
    return query
    select result.found_count, result.staged_count, result.created_count, result.updated_count,
      result.unchanged_count, result.deleted_count, result.duplicate_count
    from public.station_import_results result
    where result.run_id = p_run_id;
    return;
  end if;

  select count(*) into v_staged_count
  from public.station_import_staging
  where run_id = p_run_id and source = p_source;

  if v_staged_count = 0 then raise exception 'Import staging is empty for run %', p_run_id; end if;
  if coalesce(p_found_count, 0) < v_staged_count then
    raise exception 'found_count (%) is smaller than staged_count (%)', p_found_count, v_staged_count;
  end if;

  drop table if exists pg_temp.tmp_station_import_candidates;
  create temporary table tmp_station_import_candidates on commit drop as
  select source, external_key, city, name, address, latitude, longitude, brand,
    ai92, ai95, diesel, gas, has_queue, source_updated_at
  from (
    select staged.*,
      row_number() over (
        partition by staged.source,
          round(staged.latitude::numeric, 5),
          round(staged.longitude::numeric, 5)
        order by staged.source_updated_at desc nulls last, staged.external_key
      ) as coordinate_rank
    from public.station_import_staging staged
    where staged.run_id = p_run_id and staged.source = p_source
  ) ranked
  where coordinate_rank = 1;

  create unique index on tmp_station_import_candidates(source, external_key);
  analyze tmp_station_import_candidates;

  select count(*) into v_candidate_count from tmp_station_import_candidates;
  v_duplicate_count := greatest(coalesce(p_found_count, 0) - v_candidate_count, 0);

  select count(*) into v_existing_active_count
  from public.stations
  where external_source = p_source and is_active;

  if p_allow_deactivate and v_existing_active_count > 0
    and v_candidate_count < ceil(v_existing_active_count * v_min_ratio) then
    raise exception 'Unsafe snapshot: % candidates for % active stations (minimum ratio %)',
      v_candidate_count, v_existing_active_count, v_min_ratio;
  end if;

  drop table if exists pg_temp.tmp_station_import_changed;
  create temporary table tmp_station_import_changed(id uuid primary key) on commit drop;

  insert into tmp_station_import_changed(id)
  select station.id
  from public.stations station
  join tmp_station_import_candidates incoming
    on incoming.source = station.external_source and incoming.external_key = station.external_key
  where not station.is_active
    or (
      incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      and (
        station.city is distinct from incoming.city
        or station.name is distinct from incoming.name
        or station.address is distinct from incoming.address
        or station.latitude is distinct from incoming.latitude
        or station.longitude is distinct from incoming.longitude
        or station.brand is distinct from incoming.brand
        or station.ai92 is distinct from incoming.ai92
        or station.ai95 is distinct from incoming.ai95
        or station.diesel is distinct from incoming.diesel
        or station.gas is distinct from incoming.gas
        or station.has_queue is distinct from incoming.has_queue
      )
    );
  get diagnostics v_updated_count = row_count;

  update public.stations station set
    city = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.city else station.city end,
    name = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.name else station.name end,
    address = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.address else station.address end,
    latitude = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.latitude else station.latitude end,
    longitude = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.longitude else station.longitude end,
    brand = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.brand else station.brand end,
    ai92 = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.ai92 else station.ai92 end,
    ai95 = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.ai95 else station.ai95 end,
    diesel = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.diesel else station.diesel end,
    gas = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.gas else station.gas end,
    has_queue = case when incoming.source_updated_at is not null
      and (station.source_updated_at is null or incoming.source_updated_at >= station.source_updated_at)
      then incoming.has_queue else station.has_queue end,
    source_updated_at = case when incoming.source_updated_at is null then station.source_updated_at
      when station.source_updated_at is null then incoming.source_updated_at
      else greatest(station.source_updated_at, incoming.source_updated_at) end,
    updated_at = case when exists (select 1 from tmp_station_import_changed changed where changed.id = station.id)
      and incoming.source_updated_at is not null
      then greatest(station.updated_at, incoming.source_updated_at) else station.updated_at end,
    imported_at = v_finalized_at,
    update_source = case when exists (select 1 from tmp_station_import_changed changed where changed.id = station.id)
      and incoming.source_updated_at is not null
      then p_source else station.update_source end,
    is_active = true,
    removed_at = null,
    missing_import_runs = 0
  from tmp_station_import_candidates incoming
  where incoming.source = station.external_source and incoming.external_key = station.external_key;

  insert into public.stations (
    city, name, address, latitude, longitude, brand, ai92, ai95, diesel, gas, has_queue,
    updated_at, update_source, external_source, external_key, source_updated_at, imported_at,
    is_active, removed_at, missing_import_runs
  )
  select incoming.city, incoming.name, incoming.address, incoming.latitude, incoming.longitude,
    incoming.brand, incoming.ai92, incoming.ai95, incoming.diesel, incoming.gas, incoming.has_queue,
    coalesce(incoming.source_updated_at, v_finalized_at), p_source, incoming.source, incoming.external_key,
    incoming.source_updated_at, v_finalized_at, true, null, 0
  from tmp_station_import_candidates incoming
  where not exists (
    select 1 from public.stations station
    where station.external_source = incoming.source and station.external_key = incoming.external_key
  );
  get diagnostics v_created_count = row_count;

  v_unchanged_count := greatest(v_candidate_count - v_created_count - v_updated_count, 0);

  if p_allow_deactivate then
    select count(*) into v_deleted_count
    from public.stations station
    where station.external_source = p_source
      and station.is_active
      and station.missing_import_runs + 1 >= v_missing_threshold
      and not exists (
        select 1 from tmp_station_import_candidates incoming
        where incoming.source = station.external_source and incoming.external_key = station.external_key
      );

    update public.stations station set
      missing_import_runs = least(station.missing_import_runs + 1, 32767),
      is_active = case when station.missing_import_runs + 1 >= v_missing_threshold then false else station.is_active end,
      removed_at = case when station.missing_import_runs + 1 >= v_missing_threshold
        then coalesce(station.removed_at, v_finalized_at) else station.removed_at end
    where station.external_source = p_source
      and not exists (
        select 1 from tmp_station_import_candidates incoming
        where incoming.source = station.external_source and incoming.external_key = station.external_key
      );
  end if;

  insert into public.station_import_results (
    run_id, source, found_count, staged_count, created_count, updated_count,
    unchanged_count, deleted_count, duplicate_count, completed_at
  ) values (
    p_run_id, p_source, coalesce(p_found_count, 0), v_staged_count, v_created_count,
    v_updated_count, v_unchanged_count, v_deleted_count, v_duplicate_count, v_finalized_at
  );

  delete from public.station_import_staging where run_id = p_run_id;

  return query select
    coalesce(p_found_count, 0), v_staged_count, v_created_count, v_updated_count,
    v_unchanged_count, v_deleted_count, v_duplicate_count;
end;
$$;

revoke all on table public.station_import_staging from public, anon, authenticated;
revoke all on table public.station_import_results from public, anon, authenticated;
revoke all on function public.stage_scraped_stations(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.discard_scraped_station_import(uuid) from public, anon, authenticated;
revoke all on function public.finalize_scraped_station_import(uuid, text, integer, boolean, double precision, integer) from public, anon, authenticated;

grant execute on function public.stage_scraped_stations(uuid, jsonb) to service_role;
grant execute on function public.discard_scraped_station_import(uuid) to service_role;
grant execute on function public.finalize_scraped_station_import(uuid, text, integer, boolean, double precision, integer) to service_role;

create or replace function public.cleanup_scrape_logs(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_logs integer;
  retention interval := make_interval(days => greatest(1, least(p_retention_days, 365)));
begin
  delete from public.station_import_staging where staged_at < now() - interval '24 hours';
  delete from public.station_import_results where completed_at < now() - retention;
  delete from public.scrape_logs where started_at < now() - retention;
  get diagnostics removed_logs = row_count;
  return removed_logs;
end;
$$;

revoke all on function public.cleanup_scrape_logs(integer) from public, anon, authenticated;
grant execute on function public.cleanup_scrape_logs(integer) to service_role;
