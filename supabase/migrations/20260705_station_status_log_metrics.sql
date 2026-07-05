alter table public.scrape_logs add column if not exists station_status_available_count integer not null default 0;
alter table public.scrape_logs add column if not exists station_status_partial_count integer not null default 0;
alter table public.scrape_logs add column if not exists station_status_unavailable_count integer not null default 0;
alter table public.scrape_logs add column if not exists station_status_unknown_count integer not null default 0;
