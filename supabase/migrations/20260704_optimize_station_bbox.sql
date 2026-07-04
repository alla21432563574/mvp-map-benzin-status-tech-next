-- Индексы для bbox-выборок по текущей области карты.
-- В базовой схеме уже есть (latitude, longitude); обратный порядок
-- помогает планировщику при узких диапазонах долготы.
create index if not exists stations_longitude_latitude_idx
  on public.stations(longitude, latitude);

create index if not exists stations_latitude_idx on public.stations(latitude);
create index if not exists stations_longitude_idx on public.stations(longitude);
