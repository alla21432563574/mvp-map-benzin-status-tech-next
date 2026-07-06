-- Индексы для быстрых production-запросов карты.
-- Не меняют данные: ускоряют bbox-выборки, безопасную глобальную первую страницу
-- и будущие фильтры/сортировки по статусу и свежести.

create index if not exists stations_active_updated_idx
  on public.stations(updated_at desc, id)
  where is_active = true;

create index if not exists stations_active_status_updated_idx
  on public.stations(station_status, updated_at desc, id)
  where is_active = true;

create index if not exists stations_active_bbox_status_idx
  on public.stations(longitude, latitude, station_status, updated_at desc)
  where is_active = true;
