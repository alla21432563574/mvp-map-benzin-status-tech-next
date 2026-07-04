export const BENZIN_SOURCE = "benzin-status" as const;
const API_URL = "https://map.benzin-status.tech/api/stations";

export type FuelStatus = boolean | null;
export type ScrapedStation = {
  externalSource: typeof BENZIN_SOURCE;
  externalKey: string;
  city: string;
  name: string;
  address: string;
  brand: string;
  latitude: number;
  longitude: number;
  ai92: FuelStatus;
  ai95: FuelStatus;
  diesel: FuelStatus;
  gas: FuelStatus;
  hasQueue: FuelStatus;
  sourceUpdatedAt: string | null;
  importedAt: string;
  rawText: string;
};

type PublicApiStation = {
  id: number;
  name: string | null;
  brand: string | null;
  lat: number;
  lng: number;
  address: string | null;
  status: string;
  lastReportAt: number | null;
  fuelTypes: string[] | null;
  q: number | null;
};

export type BenzinScrapeOptions = {
  bounds: string;
  maxStations: number;
  latitude: number;
  longitude: number;
  city: string;
};

export type BenzinScrapeResult = {
  stations: ScrapedStation[];
  duplicatesDiscarded: number;
  httpStatus: number;
};

class ProtectionDetectedError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error instanceof ProtectionDetectedError || attempt === attempts) break;
      await sleep(1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500));
    }
  }
  throw lastError;
}

function parseBounds(value: string) {
  const bounds = value.split(",").map(Number);
  if (bounds.length !== 4 || bounds.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error("Некорректный SCRAPER_BOUNDS: ожидаются latMin,lngMin,latMax,lngMax");
  }
  return bounds;
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function fuelStatus(raw: PublicApiStation, key: string): FuelStatus {
  if (raw.status === "none") return false;
  const fuels = new Set(raw.fuelTypes || []);
  return fuels.size ? fuels.has(key) : null;
}

export async function fetchBenzinStations(options: BenzinScrapeOptions): Promise<BenzinScrapeResult> {
  const bounds = parseBounds(options.bounds);
  if (!Number.isFinite(options.latitude) || !Number.isFinite(options.longitude)) {
    throw new Error("Некорректные координаты SCRAPER_CITY_CENTER_LAT/LNG");
  }
  const url = new URL(API_URL);
  url.searchParams.set("bbox", bounds.join(","));
  url.searchParams.set("limit", String(options.maxStations));
  url.searchParams.set("queues", "1");
  url.searchParams.set("center", `${options.longitude},${options.latitude}`);

  return withRetry(async () => {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "benzin-status-mvp-scraper/1.0 (+low-rate public-data import)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 403 || response.status === 429) {
      throw new ProtectionDetectedError(`Сайт вернул HTTP ${response.status}; scraper остановлен без обхода защиты.`);
    }
    if (!response.ok) throw new Error(`Публичный stations API вернул HTTP ${response.status}`);
    const json = await response.json() as { stations?: unknown } | unknown[];
    const rows = Array.isArray(json) ? json : json.stations;
    if (!Array.isArray(rows)) throw new Error("Публичный stations API вернул неожиданный формат");

    const stations: ScrapedStation[] = [];
    const ids = new Set<number>();
    const identities = new Set<string>();
    let duplicatesDiscarded = 0;
    const importedAt = new Date().toISOString();
    for (const raw of (rows as PublicApiStation[]).slice(0, options.maxStations)) {
      if (!Number.isFinite(raw.id) || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) continue;
      const name = raw.name || raw.brand || `АЗС ${raw.id}`;
      const address = raw.address || `Точка ${raw.lat.toFixed(5)}, ${raw.lng.toFixed(5)}`;
      const identity = `${normalizeText(name)}|${normalizeText(address)}|${raw.lat.toFixed(5)}|${raw.lng.toFixed(5)}`;
      if (ids.has(raw.id) || identities.has(identity)) {
        duplicatesDiscarded += 1;
        continue;
      }
      ids.add(raw.id);
      identities.add(identity);
      stations.push({
        externalSource: BENZIN_SOURCE, externalKey: String(raw.id), city: options.city, name, address,
        brand: raw.brand || name, latitude: raw.lat, longitude: raw.lng,
        ai92: fuelStatus(raw, "ai92"), ai95: fuelStatus(raw, "ai95"), diesel: fuelStatus(raw, "dt"), gas: fuelStatus(raw, "gas"),
        hasQueue: typeof raw.q === "number" ? raw.q > 0 : null,
        sourceUpdatedAt: raw.lastReportAt ? new Date(raw.lastReportAt).toISOString() : null,
        importedAt, rawText: JSON.stringify(raw),
      });
    }
    return { stations, duplicatesDiscarded, httpStatus: response.status };
  });
}
