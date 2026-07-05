alter table public.scrape_logs add column if not exists reports_skipped_count integer not null default 0;
alter table public.scrape_logs add column if not exists reports_error_count integer not null default 0;
alter table public.scrape_logs add column if not exists reports_errors jsonb;
