import { mkdir, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { BENZIN_SOURCE as SOURCE, fetchBenzinStations, type BenzinScrapeResult, type ScrapedStation } from "../lib/benzin-scraper";

dotenv.config({ path: ".env.local" });
dotenv.config();

const LOCK_PATH = path.resolve(".scrape-benzin-status.lock");
const DEBUG_DIR = path.resolve("outputs/scraper-debug");

type RunStats = { found: number; updated: number; created: number; skipped: number };

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
  lockSeconds: Math.max(600, Math.min(3_600, Number(process.env.SCRAPER_LOCK_SECONDS || 3_600))),
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

async function fetchStations(): Promise<BenzinScrapeResult> {
  return fetchBenzinStations({
    bounds: config.bounds,
    mode: config.mode,
    maxStations: config.maxStations,
    latitude: config.latitude,
    longitude: config.longitude,
    city: config.city,
    gridStepDegrees: config.gridStepDegrees,
    requestDelayMs: config.requestDelayMs,
    onProgress: ({ requests, tiles, stations, duplicates }) => {
      console.log(`Прогресс: запросов ${requests}, тайлов ${tiles}, АЗС ${stations}, дублей ${duplicates}.`);
    },
  });
}

async function createLog(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("scrape_logs").insert({ source: SOURCE, status: "running" }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function finishLog(supabase: SupabaseClient, id: string, status: "success" | "failed" | "skipped", stats: RunStats, errorMessage?: string) {
  const { error } = await supabase.from("scrape_logs").update({
    finished_at: new Date().toISOString(), status, found_count: stats.found,
    updated_count: stats.updated, created_count: stats.created,
    error_message: errorMessage?.slice(0, 2_000) ?? null,
  }).eq("id", id);
  if (error) console.error("Не удалось завершить scrape_logs:", error.message);
}

async function importStations(supabase: SupabaseClient, stations: ScrapedStation[], stats: RunStats) {
  const batchSize = 100;
  for (let offset = 0; offset < stations.length; offset += batchSize) {
    const batch = stations.slice(offset, offset + batchSize).map(({ rawText: _rawText, ...station }) => station);
    let data: unknown = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await supabase.rpc("bulk_upsert_scraped_stations", { p_stations: batch });
      if (!response.error) {
        data = response.data;
        lastError = null;
        break;
      }
      lastError = response.error;
      if (attempt < 3) {
        const delay = 1_000 * 2 ** (attempt - 1);
        console.warn(`Supabase batch ${offset + 1}-${offset + batch.length}: ${describeError(lastError)}; retry ${attempt + 1}/3 через ${delay} мс.`);
        await sleep(delay);
      }
    }
    if (lastError) throw new Error(`Supabase batch ${offset + 1}-${offset + batch.length}: ${describeError(lastError)}`);
    const batchStats = Array.isArray(data) ? data[0] : data;
    stats.created += Number(batchStats?.created_count || 0);
    stats.updated += Number(batchStats?.updated_count || 0);
    stats.skipped += Number(batchStats?.skipped_count || 0);
    console.log(`Supabase upsert: ${Math.min(offset + batchSize, stations.length)}/${stations.length}.`);
  }
}

async function runOnce() {
  assertConfig();
  let supabase = !config.dryRun && isSupabaseConfigured()
    ? createClient(config.supabaseUrl!, config.serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  if (!config.dryRun && !supabase) console.warn("Supabase не настроен, результаты не будут сохранены.");

  const lock = await acquireLock();
  const stats: RunStats = { found: 0, updated: 0, created: 0, skipped: 0 };
  if (!lock) {
    console.log("Scraping пропущен: предыдущий запуск ещё выполняется.");
    return;
  }

  let logId: string | null = null;
  let distributedLockToken: string | null = null;
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
      logId = await createLog(supabase);
    }

    if (config.debug || config.dryRun) await mkdir(DEBUG_DIR, { recursive: true });
    const result = await fetchStations();
    stats.found = result.stations.length;
    if (config.debug || config.dryRun) {
      await writeFile(path.join(DEBUG_DIR, "results.json"), JSON.stringify(result.stations, null, 2), "utf8");
    }
    if (config.dryRun) {
      console.log("Dry-run: подключение к Supabase отключено. Собранные данные:");
      console.log(JSON.stringify(result.stations, null, 2));
    } else if (supabase) {
      await importStations(supabase, result.stations, stats);
    }

    const fuelStatuses = result.stations.reduce(
      (total, station) => total + [station.ai92, station.ai95, station.diesel, station.gas].filter((value) => value !== null).length,
      0,
    );
    console.log(`Метрики: режим ${config.mode}; HTTP ${result.httpStatus}; запросов ${result.requestCount}; тайлов ${result.tilesProcessed}; АЗС найдено ${result.stations.length}; дублей отброшено ${result.duplicatesDiscarded}; вне России отброшено ${result.outsideRussiaDiscarded}; обрезанных тайлов ${result.truncatedTiles}; статусов топлива ${fuelStatuses}; время ${result.durationMs} мс.`);
    if (supabase && logId) await finishLog(supabase, logId, "success", stats);
    console.log(`Готово: найдено ${stats.found}, создано ${stats.created}, обновлено ${stats.updated}, пропущено ${stats.skipped}.`);
  } catch (error) {
    const message = describeError(error);
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
