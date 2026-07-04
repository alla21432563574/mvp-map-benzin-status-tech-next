import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { BENZIN_SOURCE, fetchBenzinStations } from "@/lib/benzin-scraper";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Stats = { found: number; created: number; updated: number; skipped: number };

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (!secret || authorization.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function numberInRange(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase service role is not configured" }, { status: 500 });

  const errors: string[] = [];
  const retentionDays = numberInRange(process.env.SCRAPE_LOG_RETENTION_DAYS, 30, 1, 365);
  const { data: deletedLogsData, error: cleanupError } = await supabase.rpc("cleanup_scrape_logs", {
    p_retention_days: retentionDays,
  });
  const deletedLogs = Number(deletedLogsData || 0);
  if (cleanupError) errors.push(`Log cleanup: ${cleanupError.message}`);

  const token = crypto.randomUUID();
  const leaseSeconds = numberInRange(process.env.SCRAPER_LOCK_SECONDS, 600, 300, 3_600);
  const { data: acquired, error: lockError } = await supabase.rpc("try_acquire_scrape_lock", {
    p_source: BENZIN_SOURCE, p_token: token, p_lease_seconds: leaseSeconds,
  });
  if (lockError) return NextResponse.json({ error: lockError.message }, { status: 500 });
  if (!acquired) {
    const skippedAt = new Date().toISOString();
    await supabase.from("scrape_logs").insert({
      source: BENZIN_SOURCE, status: "skipped", started_at: skippedAt, finished_at: skippedAt,
      error_message: "Scraper already running",
    });
    return NextResponse.json({ error: "Scraper already running", deletedLogs, cleanupErrors: errors, durationMs: Date.now() - startedAt }, { status: 409 });
  }

  let logId: string | null = null;
  const stats: Stats = { found: 0, created: 0, updated: 0, skipped: 0 };
  try {
    const { data: log, error: logError } = await supabase
      .from("scrape_logs").insert({ source: BENZIN_SOURCE, status: "running" }).select("id").single();
    if (logError) throw logError;
    logId = log.id as string;

    const result = await fetchBenzinStations({
      bounds: process.env.SCRAPER_BOUNDS || "55.40,36.80,56.10,38.40",
      maxStations: numberInRange(process.env.SCRAPER_MAX_STATIONS_PER_RUN, 5_000, 1, 5_000),
      latitude: Number(process.env.SCRAPER_CITY_CENTER_LAT || 55.7558),
      longitude: Number(process.env.SCRAPER_CITY_CENTER_LNG || 37.6173),
      city: process.env.SCRAPER_CITY || "Москва",
    });
    stats.found = result.stations.length;

    const { data: imported, error: importError } = await supabase.rpc("bulk_upsert_scraped_stations", {
      p_stations: result.stations.map(({ rawText: _rawText, ...station }) => station),
    });
    if (importError) throw importError;
    const importedStats = Array.isArray(imported) ? imported[0] : imported;
    stats.created = Number(importedStats?.created_count || 0);
    stats.updated = Number(importedStats?.updated_count || 0);
    stats.skipped = Number(importedStats?.skipped_count || 0);

    const { error: finishError } = await supabase.from("scrape_logs").update({
      finished_at: new Date().toISOString(), status: "success", found_count: stats.found,
      created_count: stats.created, updated_count: stats.updated,
      error_message: errors.length ? errors.join("; ").slice(0, 2_000) : null,
    }).eq("id", logId);
    if (finishError) throw finishError;
    return NextResponse.json({ ...stats, deletedLogs, retentionDays, durationMs: Date.now() - startedAt, errors });
  } catch (error) {
    errors.push(errorMessage(error));
    if (logId) {
      await supabase.from("scrape_logs").update({
        finished_at: new Date().toISOString(), status: "failed", found_count: stats.found,
        created_count: stats.created, updated_count: stats.updated, error_message: errors.join("; ").slice(0, 2_000),
      }).eq("id", logId);
    }
    return NextResponse.json({ ...stats, deletedLogs, retentionDays, durationMs: Date.now() - startedAt, errors }, { status: 500 });
  } finally {
    await supabase.rpc("release_scrape_lock", { p_source: BENZIN_SOURCE, p_token: token });
  }
}
