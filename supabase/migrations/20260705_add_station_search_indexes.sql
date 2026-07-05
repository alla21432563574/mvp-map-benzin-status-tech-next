-- Ускоряет поиск по подстроке через ILIKE, не меняя структуру данных АЗС.
create extension if not exists pg_trgm;

create index if not exists stations_name_trgm_idx
  on public.stations using gin (name gin_trgm_ops);

create index if not exists stations_brand_trgm_idx
  on public.stations using gin (brand gin_trgm_ops);

create index if not exists stations_city_trgm_idx
  on public.stations using gin (city gin_trgm_ops);

create index if not exists stations_address_trgm_idx
  on public.stations using gin (address gin_trgm_ops);
