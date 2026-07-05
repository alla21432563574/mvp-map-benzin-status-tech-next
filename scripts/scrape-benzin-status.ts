import { mkdir, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { BENZIN_SOURCE as SOURCE, fetchBenzinStations, type BenzinScrapeResult } from "../lib/benzin-scraper";
import { atomicImportStations, importStationReports, loadStationReportCursors, syncStationReportCursors } from "../lib/station-import";

dotenv.config({ path: ".env.local" });
dotenv.config();

const LOCK_PATH = path.resolve(".scrape-benzin-status.lock");
const DEBUG_DIR = path.resolve("outputs/scraper-debug");

type RunStats = {
  found: number;
  staged: number;
  updated: number;
  created: number;
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
  reportsSkipped: number;
  reportsErrors: string[];
};

const config = {
  enabled: process.env.SCRAPER_ENABLED === "true",
  dryRun: process.argv.includes("--dry-run"),
  debug: process.argv.includes("--debug"),
  once: process.argv.includes("--once") || process.argv.includes("--debug"),
  intervalSeconds: Math.max(60, Number(process.env.SCRAPER_INTERVAL_SECONDS || 180)),
  mode: process.env.SCRAPER_MODE === "russia" ? "russia" as const : "city" as const,
  latitude: Number(process.env.SCRAPER_CITY_CENTER_LAT || 55.7558),
  longitude: Number(process.env.SCRAPER_CITY_CENTER_LNG || 37.6173),
  city: process.env.SCRAPER_CITY || "Москва",
  maxStations: Math.min(5_000, Math.max(1, Number(process.env.SCRAPER_MAX_STATIONS_PER_RUN || 5_000))),
  bounds: process.env.SCRAPER_BOUNDS || "55.40,36.80,56.10,38.40",
  gridStepDegrees: Math.max(0.5, Math.min(10, Number(process.env.SCRAPER_GRID_STEP_DEGREES || 4))),
  requestDelayMs: Math.max(100, Math.min(5_000, Number(process.env.SCRAPER_REQUEST_DELAY_MS || 250))),
  reportsMode: process.env.SCRAPER_REPORTS_MODE === "backfill" ? "backfill" as const : "incremental" as const,
  reportLookbackHours: Math.max(1, Math.min(168, Number(process.env.SCRAPER_REPORT_LOOKBACK_HOURS || 2))),
  maxReportStationRequests: Math.max(1, Math.min(10_000, Number(process.env.SCRAPER_MAX_REPORT_STATIONS || 2_000))),
  lockSeconds: Math.max(600, Math.min(3_600, Number(process.env.SCRAPER_LOCK_SECONDS || 3_600))),
  minimumSnapshotRatio: Math.max(0.5, Math.min(1, Number(process.env.SCRAPER_MIN_SNAPSHOT_RATIO || 0.85))),
  missingRunsBeforeDeactivate: Math.max(1, Math.min(20, Number(process.env.SCRAPER_MISSING_RUNS_BEFORE_DEACTIVATE || 3))),
  logRetentionDays: Math.max(1, Math.min(365, Number(process.env.SCRAPE_LOG_RETENTION_DAYS || 30))),
  supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

let shuttingDown = false;
process.once("SIGINT", () => { shuttingDown = true; });
process.once("SIGTERM", () => { shuttingDown = true; });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const details = error as { message?: string; code?: string; details?: string; hint?: string };
    return [details.code, details.message, details.details, details.hint].filter(Boolean).join(": ") || JSON.stringify(error);
  }
  return String(error);
}

function parseBounds() {
  const bounds = config.bounds.split(",").map(Number);
  if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) {
    throw new Error("Некорректный SCRAPER_BOUNDS: ожидаются latMin,lngMin,latMax,lngMax");
  }
  return bounds;
}

function assertConfig() {
  if (config.mode === "city") parseBounds();
  if (!Number.isFinite(config.latitude) || !Number.isFinite(config.longitude)) {
    throw new Error("Некорректные координаты SCRAPER_CITY_CENTER_LAT/LNG");
  }
}

function isSupabaseConfigured() {
  if (!config.supabaseUrl || !config.serviceRoleKey) return false;
  if (/your-project|replace|example/i.test(config.supabaseUrl) || /your-|replace|example/i.test(config.serviceRoleKey)) return false;
  try {
    return new URL(config.supabaseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLock(canRecoverStale = true): Promise<FileHandle | null> {
  try {
    const handle = await open(LOCK_PATH, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!canRecoverStale) return null;
    try {
      const lockData = JSON.parse(await readFile(LOCK_PATH, "utf8")) as { pid?: number };
      if (lockData.pid && isProcessAlive(lockData.pid)) return null;
    } catch {
      // Повреждённый lock безопасно считается устаревшим.
    }
    await rm(LOCK_PATH, { force: true });
    console.warn("Обнаружен устаревший lock-файл, запуск восстановлен.");
    return acquireLock(false);
  }
}

async function releaseLock(handle: FileHandle | null) {
  if (!handle) return;
  await handle.close().catch(() => undefined);
  await rm(LOCK_PATH, { force: true }).catch(() => undefined);
}

async function fetchStations(reportSinceMs: number, reportCursors: ReadonlyMap<string, number>): Promise<BenzinScrapeResult> {
  return fetchBenzinStations({
    bounds: config.bounds,
    mode: config.mode,
    maxStations: config.maxStations,
    latitude: config.latitude,
    longitude: config.longitude,
    city: config.city,
    gridStepDegrees: config.gridStepDegrees,
    requestDelayMs: config.requestDelayMs,
    reportsMode: config.reportsMode,
    reportSinceMs,
    maxReportStationRequests: config.maxReportStationRequests,
    reportCursors,
    onProgress: ({ requests, tiles, stations, duplicates }) => {
      console.log(`Прогресс: запросов ${requests}, тайлов ${tiles}, АЗС ${stations}, дублей ${duplicates}.`);
    },
  });
}

async function createLog(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase.from("scrape_logs").insert({ source: SOURCE, status: "running", run_id: runId }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function finishLog(supabase: SupabaseClient, id: string, status: "success" | "failed" | "skipped", stats: RunStats, errorMessage?: string) {
  const { error } = await supabase.from("scrape_logs").update({
    finished_at: new Date().toISOString(), status, found_count: stats.found,
    updated_count: stats.updated, created_count: stats.created,
    unchanged_count: stats.unchanged, deleted_count: stats.deleted,
    duplicate_count: stats.duplicates, skipped_count: stats.skipped,
    request_count: stats.requestCount, fetch_duration_ms: stats.fetchDurationMs,
    import_duration_ms: stats.importDurationMs,
    duration_ms: stats.fetchDurationMs + stats.importDurationMs,
    reports_found_count: stats.reportsFound,
    reports_created_count: stats.reportsCreated,
    reports_unchanged_count: stats.reportsUnchanged,
    report_request_count: stats.reportRequestCount,
    reports_skipped_count: stats.reportsSkipped,
    reports_error_count: stats.reportsErrors.length,
    reports_errors: stats.reportsErrors.length ? stats.reportsErrors.slice(0, 100) : null,
    error_message: errorMessage?.slice(0, 2_000) ?? null,
    error_details: errorMessage ? { message: errorMessage, recordedAt: new Date().toISOString() } : null,
  }).eq("id", id);
  if (error) console.error("Не удалось завершить scrape_logs:", error.message);
}

async function runOnce() {
  assertConfig();
  let supabase = !config.dryRun && isSupabaseConfigured()
    ? createClient(config.supabaseUrl!, config.serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  if (!config.dryRun && !supabase) console.warn("Supabase не настроен, результаты не будут сохранены.");

  const lock = await acquireLock();
  const stats: RunStats = {
    found: 0, staged: 0, updated: 0, created: 0, unchanged: 0, deleted: 0,
    duplicates: 0, skipped: 0, requestCount: 0, fetchDurationMs: 0, importDurationMs: 0,
    reportsFound: 0, reportsCreated: 0, reportsUnchanged: 0, reportRequestCount: 0,
    reportsSkipped: 0, reportsErrors: [],
  };
  if (!lock) {
    console.log("Scraping пропущен: предыдущий запуск ещё выполняется.");
    return;
  }

  let logId: string | null = null;
  let distributedLockToken: string | null = null;
  let reportSinceMs = Date.now() - config.reportLookbackHours * 60 * 60 * 1_000;
  let reportCursors = new Map<string, number>();
  let phase = "lock";
  try {
    if (supabase) {
      const token = randomUUID();
      const { data: acquired, error: lockError } = await supabase.rpc("try_acquire_scrape_lock", {
        p_source: SOURCE, p_token: token, p_lease_seconds: config.lockSeconds,
      });
      if (lockError) throw lockError;
      if (!acquired) {
        const skippedAt = new Date().toISOString();
        await supabase.from("scrape_logs").insert({
          source: SOURCE, status: "skipped", started_at: skippedAt, finished_at: skippedAt,
          error_message: "Scraper already running",
        });
        console.log("Scraper already running.");
        return;
      }
      distributedLockToken = token;
      await supabase.rpc("cleanup_scrape_logs", { p_retention_days: config.logRetentionDays });
      let previousRunQuery = supabase.from("scrape_logs")
        .select("started_at").eq("source", SOURCE).eq("status", "success");
      if (config.mode === "russia") previousRunQuery = previousRunQuery.gte("found_count", 10_000);
      const { data: previousRun } = await previousRunQuery.order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (previousRun?.started_at) reportSinceMs = new Date(previousRun.started_at).getTime() - 5 * 60 * 1_000;
      reportCursors = await loadStationReportCursors(supabase, SOURCE);
      logId = await createLog(supabase, token);
    }

    if (config.debug || config.dryRun) await mkdir(DEBUG_DIR, { recursive: true });
    phase = "fetch";
    const fetchStartedAt = Date.now();
    const result = await fetchStations(reportSinceMs, reportCursors);
    stats.fetchDurationMs = Date.now() - fetchStartedAt;
    stats.found = result.stations.length;
    stats.requestCount = result.requestCount;
    stats.reportRequestCount = result.reportRequestCount;
    stats.reportsFound = result.reports.length;
    stats.skipped = result.reportCandidatesSkipped;
    stats.reportsSkipped = result.reportCandidatesSkipped;
    stats.reportsErrors = result.reportErrors;
    stats.duplicates = result.duplicatesDiscarded;
    if (config.debug || config.dryRun) {
      await writeFile(path.join(DEBUG_DIR, "results.json"), JSON.stringify(result.stations, null, 2), "utf8");
      await writeFile(path.join(DEBUG_DIR, "reports.json"), JSON.stringify(result.reports, null, 2), "utf8");
    }
    if (config.dryRun) {
      console.log("Dry-run: подключение к Supabase отключено. Собранные данные:");
      console.log(JSON.stringify(result.stations, null, 2));
      console.log(`Последних отметок: ${result.reports.length}. Они сохранены в ${path.join(DEBUG_DIR, "reports.json")}.`);
    } else if (supabase) {
      phase = "import";
      const importStartedAt = Date.now();
      let imported;
      try {
        imported = await atomicImportStations(supabase, result.stations, {
          runId: distributedLockToken!,
          source: SOURCE,
          foundCount: result.stations.length,
          allowDeactivate: config.mode === "russia" && result.truncatedTiles === 0,
          minimumSnapshotRatio: config.minimumSnapshotRatio,
          missingRunsBeforeDeactivate: config.missingRunsBeforeDeactivate,
          onProgress: (staged, total) => console.log(`Supabase staging: ${staged}/${total}.`),
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
      const importedReports = await importStationReports(supabase, result.reports, SOURCE);
      stats.reportsCreated = importedReports.created;
      stats.reportsUnchanged = importedReports.unchanged;
      if (importedReports.missingStations) {
        console.warn(`Отметок без найденной АЗС: ${importedReports.missingStations}.`);
      }
      await syncStationReportCursors(supabase, SOURCE, result.reportCursors);
    }

    const fuelStatuses = result.stations.reduce(
      (total, station) => total + [station.ai92, station.ai95, station.diesel, station.gas].filter((value) => value !== null).length,
      0,
    );
    console.log(`Метрики: режим ${config.mode}; режим отметок ${config.reportsMode}; HTTP ${result.httpStatus}; запросов станций ${result.requestCount}; запросов истории ${result.reportRequestCount}; отложено карточек истории ${result.reportCandidatesSkipped}; ошибок истории ${result.reportErrors.length}; тайлов ${result.tilesProcessed}; АЗС найдено ${result.stations.length}; отметок найдено ${result.reports.length}; дублей отброшено ${result.duplicatesDiscarded}; вне России отброшено ${result.outsideRussiaDiscarded}; обрезанных тайлов ${result.truncatedTiles}; статусов топлива ${fuelStatuses}; время ${result.durationMs} мс.`);
    if (result.reportErrors.length) console.warn(`Ошибки истории:\n${result.reportErrors.slice(0, 20).join("\n")}`);
    phase = "logging";
    if (supabase && logId) await finishLog(supabase, logId, "success", stats);
    console.log(`Готово: найдено ${stats.found}, создано ${stats.created}, обновлено ${stats.updated}, без изменений ${stats.unchanged}, удалено ${stats.deleted}, дублей ${stats.duplicates}; отметок новых ${stats.reportsCreated}, повторных ${stats.reportsUnchanged}.`);
  } catch (error) {
    const message = `${phase}: ${describeError(error)}`;
    if (supabase && logId) await finishLog(supabase, logId, "failed", stats, message);
    console.error("Scraping завершился с ошибкой:", message);
    if (config.once) process.exitCode = 1;
  } finally {
    if (supabase && distributedLockToken) {
      try {
        await supabase.rpc("release_scrape_lock", { p_source: SOURCE, p_token: distributedLockToken });
      } catch {
        // Lease истечёт автоматически, даже если сеть не дала освободить lock.
      }
    }
    await releaseLock(lock);
  }
}

async function main() {
  if (!config.enabled && !config.dryRun) {
    console.log("Scraping отключён: установите SCRAPER_ENABLED=true.");
    return;
  }
  do {
    await runOnce();
    if (config.once || shuttingDown) break;
    await sleep(config.intervalSeconds * 1_000);
  } while (!shuttingDown);
}

void main();
