import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { BENZIN_SOURCE, fetchBenzinStations } from "@/lib/benzin-scraper";
import { atomicImportStations, importStationReports, loadStationReportCursors, syncStationReportCursors } from "@/lib/station-import";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Stats = {
  found: number;
  staged: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  duplicates: number;
  skipped: number;
  requestCount: number;
  fetchDurationMs: number;
  importDurationMs: number;
  reportsFound: number;
  reportsCreated: number;
  reportsUnchanged: number;
  reportRequestCount: number;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (!secret || authorization.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { code?: string; message?: string; details?: string; hint?: string };
    return [value.code, value.message, value.details, value.hint].filter(Boolean).join(": ") || JSON.stringify(error);
  }
  return String(error);
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
  const stats: Stats = {
    found: 0, staged: 0, created: 0, updated: 0, unchanged: 0, deleted: 0,
    duplicates: 0, skipped: 0, requestCount: 0, fetchDurationMs: 0, importDurationMs: 0,
    reportsFound: 0, reportsCreated: 0, reportsUnchanged: 0, reportRequestCount: 0,
  };
  let phase = "logging";
  try {
    const { data: log, error: logError } = await supabase
      .from("scrape_logs").insert({ source: BENZIN_SOURCE, status: "running", run_id: token }).select("id").single();
    if (logError) throw logError;
    logId = log.id as string;

    const scraperMode = process.env.SCRAPER_MODE === "russia" ? "russia" as const : "city" as const;
    const reportLookbackHours = numberInRange(process.env.SCRAPER_REPORT_LOOKBACK_HOURS, 2, 1, 168);
    let reportSinceMs = Date.now() - reportLookbackHours * 60 * 60 * 1_000;
    let previousRunQuery = supabase.from("scrape_logs")
      .select("started_at").eq("source", BENZIN_SOURCE).eq("status", "success");
    if (scraperMode === "russia") previousRunQuery = previousRunQuery.gte("found_count", 10_000);
    const { data: previousRun } = await previousRunQuery.order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (previousRun?.started_at) reportSinceMs = new Date(previousRun.started_at).getTime() - 5 * 60 * 1_000;
    const reportCursors = await loadStationReportCursors(supabase, BENZIN_SOURCE);

    phase = "fetch";
    const fetchStartedAt = Date.now();
    const result = await fetchBenzinStations({
      mode: scraperMode,
      bounds: process.env.SCRAPER_BOUNDS || "55.40,36.80,56.10,38.40",
      maxStations: numberInRange(process.env.SCRAPER_MAX_STATIONS_PER_RUN, 5_000, 1, 5_000),
      latitude: Number(process.env.SCRAPER_CITY_CENTER_LAT || 55.7558),
      longitude: Number(process.env.SCRAPER_CITY_CENTER_LNG || 37.6173),
      city: process.env.SCRAPER_CITY || "Москва",
      gridStepDegrees: numberInRange(process.env.SCRAPER_GRID_STEP_DEGREES, 4, 0.5, 10),
      requestDelayMs: numberInRange(process.env.SCRAPER_REQUEST_DELAY_MS, 250, 100, 5_000),
      reportSinceMs,
      maxReportStationRequests: numberInRange(process.env.SCRAPER_MAX_REPORT_STATIONS, 2_000, 1, 10_000),
      reportCursors,
    });
    stats.fetchDurationMs = Date.now() - fetchStartedAt;
    stats.found = result.stations.length;
    stats.requestCount = result.requestCount;
    stats.reportRequestCount = result.reportRequestCount;
    stats.reportsFound = result.reports.length;
    stats.skipped = result.reportCandidatesSkipped;
    stats.duplicates = result.duplicatesDiscarded;

    phase = "import";
    const importStartedAt = Date.now();
    let imported;
    try {
      imported = await atomicImportStations(supabase, result.stations, {
        runId: token,
        source: BENZIN_SOURCE,
        foundCount: result.stations.length,
        allowDeactivate: scraperMode === "russia" && result.truncatedTiles === 0,
        minimumSnapshotRatio: numberInRange(process.env.SCRAPER_MIN_SNAPSHOT_RATIO, 0.85, 0.5, 1),
        missingRunsBeforeDeactivate: numberInRange(process.env.SCRAPER_MISSING_RUNS_BEFORE_DEACTIVATE, 3, 1, 20),
      });
    } finally {
      stats.importDurationMs = Date.now() - importStartedAt;
    }
    stats.staged = imported.staged;
    stats.created = imported.created;
    stats.updated = imported.updated;
    stats.unchanged = imported.unchanged;
    stats.deleted = imported.deleted;
    stats.duplicates += imported.duplicates;
    const importedReports = await importStationReports(supabase, result.reports, BENZIN_SOURCE);
    stats.reportsCreated = importedReports.created;
    stats.reportsUnchanged = importedReports.unchanged;
    if (importedReports.missingStations) errors.push(`Reports without station: ${importedReports.missingStations}`);
    await syncStationReportCursors(supabase, BENZIN_SOURCE, result.reportCursors);

    phase = "logging";
    const { error: finishError } = await supabase.from("scrape_logs").update({
      finished_at: new Date().toISOString(), status: "success", found_count: stats.found,
      created_count: stats.created, updated_count: stats.updated,
      unchanged_count: stats.unchanged, deleted_count: stats.deleted,
      duplicate_count: stats.duplicates, skipped_count: stats.skipped,
      request_count: stats.requestCount, fetch_duration_ms: stats.fetchDurationMs,
      import_duration_ms: stats.importDurationMs, duration_ms: Date.now() - startedAt,
      reports_found_count: stats.reportsFound, reports_created_count: stats.reportsCreated,
      reports_unchanged_count: stats.reportsUnchanged, report_request_count: stats.reportRequestCount,
      error_message: errors.length ? errors.join("; ").slice(0, 2_000) : null,
      error_details: errors.length ? { errors, recordedAt: new Date().toISOString() } : null,
    }).eq("id", logId);
    if (finishError) throw finishError;
    return NextResponse.json({ ...stats, deletedLogs, retentionDays, durationMs: Date.now() - startedAt, errors });
  } catch (error) {
    errors.push(`${phase}: ${errorMessage(error)}`);
    if (logId) {
      await supabase.from("scrape_logs").update({
        finished_at: new Date().toISOString(), status: "failed", found_count: stats.found,
        created_count: stats.created, updated_count: stats.updated,
        unchanged_count: stats.unchanged, deleted_count: stats.deleted,
        duplicate_count: stats.duplicates, skipped_count: stats.skipped,
        request_count: stats.requestCount, fetch_duration_ms: stats.fetchDurationMs,
        import_duration_ms: stats.importDurationMs, duration_ms: Date.now() - startedAt,
        reports_found_count: stats.reportsFound, reports_created_count: stats.reportsCreated,
        reports_unchanged_count: stats.reportsUnchanged, report_request_count: stats.reportRequestCount,
        error_message: errors.join("; ").slice(0, 2_000),
        error_details: { errors, recordedAt: new Date().toISOString() },
      }).eq("id", logId);
    }
    return NextResponse.json({ ...stats, deletedLogs, retentionDays, durationMs: Date.now() - startedAt, errors }, { status: 500 });
  } finally {
    await supabase.rpc("release_scrape_lock", { p_source: BENZIN_SOURCE, p_token: token });
  }
}
