import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScrapedStation } from "./benzin-scraper";

export type AtomicImportStats = {
  found: number;
  staged: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  duplicates: number;
};

type AtomicImportOptions = {
  runId: string;
  source: string;
  foundCount: number;
  allowDeactivate: boolean;
  minimumSnapshotRatio?: number;
  missingRunsBeforeDeactivate?: number;
  batchSize?: number;
  onProgress?: (staged: number, total: number) => void;
};

function errorDescription(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { code?: string; message?: string; details?: string; hint?: string };
    return [value.code, value.message, value.details, value.hint].filter(Boolean).join(": ") || JSON.stringify(error);
  }
  return String(error);
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function stageBatch(supabase: SupabaseClient, runId: string, batch: ScrapedStation[]) {
  const payload = batch.map((station) => ({
    external_source: station.externalSource,
    external_key: station.externalKey,
    city: station.city,
    name: station.name,
    address: station.address,
    latitude: station.latitude,
    longitude: station.longitude,
    brand: station.brand,
    ai92: station.ai92,
    ai95: station.ai95,
    diesel: station.diesel,
    gas: station.gas,
    has_queue: station.hasQueue,
    source_updated_at: station.sourceUpdatedAt,
  }));

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await supabase.rpc("stage_scraped_stations", { p_run_id: runId, p_stations: payload });
    if (!error) return;
    lastError = error;
    if (attempt < 3) await wait(1_000 * 2 ** (attempt - 1));
  }
  throw new Error(`Staging failed: ${errorDescription(lastError)}`);
}

export async function atomicImportStations(
  supabase: SupabaseClient,
  stations: ScrapedStation[],
  options: AtomicImportOptions,
): Promise<AtomicImportStats> {
  const batchSize = Math.max(100, Math.min(1_000, options.batchSize ?? 500));
  try {
    for (let offset = 0; offset < stations.length; offset += batchSize) {
      await stageBatch(supabase, options.runId, stations.slice(offset, offset + batchSize));
      options.onProgress?.(Math.min(offset + batchSize, stations.length), stations.length);
    }

    // Финализация идемпотентна: результат сохраняется по run_id. Повтор нужен,
    // когда сервер завершил транзакцию, но HTTP-ответ потерялся в сети.
    let result: unknown;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await supabase.rpc("finalize_scraped_station_import", {
        p_run_id: options.runId,
        p_source: options.source,
        p_found_count: options.foundCount,
        p_allow_deactivate: options.allowDeactivate,
        p_min_snapshot_ratio: options.minimumSnapshotRatio ?? 0.85,
        p_missing_runs_before_deactivate: options.missingRunsBeforeDeactivate ?? 3,
      });
      if (!response.error) {
        result = Array.isArray(response.data) ? response.data[0] : response.data;
        lastError = null;
        break;
      }
      lastError = response.error;
      if (attempt < 2) await wait(1_500);
    }
    if (lastError) throw new Error(`Finalization failed: ${errorDescription(lastError)}`);

    const stats = (result || {}) as Record<string, unknown>;
    return {
      found: Number(stats.found_count || options.foundCount),
      staged: Number(stats.staged_count || 0),
      created: Number(stats.created_count || 0),
      updated: Number(stats.updated_count || 0),
      unchanged: Number(stats.unchanged_count || 0),
      deleted: Number(stats.deleted_count || 0),
      duplicates: Number(stats.duplicate_count || 0),
    };
  } catch (error) {
    const { error: cleanupError } = await supabase.rpc("discard_scraped_station_import", { p_run_id: options.runId });
    if (cleanupError) {
      throw new Error(`${errorDescription(error)}; staging cleanup failed: ${errorDescription(cleanupError)}`);
    }
    throw error;
  }
}
