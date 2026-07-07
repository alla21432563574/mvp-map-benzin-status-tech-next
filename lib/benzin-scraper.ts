import booleanIntersects from "@turf/boolean-intersects";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { polygon } from "@turf/helpers";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-50m.json";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

export const BENZIN_SOURCE = "benzin-status" as const;
const API_URL = "https://map.benzin-status.tech/api/stations";
const STATION_DETAIL_URL = "https://map.benzin-status.tech/api/stations";
const RUSSIA_BOUNDS = { south: 41, west: 19, north: 82, east: -169 };
const MIN_TILE_STEP = 0.25;
const atlasTopology = worldAtlas as unknown as Topology;
const countries = feature(
  atlasTopology,
  atlasTopology.objects.countries as GeometryCollection,
) as unknown as FeatureCollection<Polygon | MultiPolygon>;
const RUSSIA_FEATURE = countries.features.find((country) => String(country.id) === "643") as Feature<Polygon | MultiPolygon>;
if (!RUSSIA_FEATURE) throw new Error("В world-atlas не найдена граница России (ISO 643)");

export type FuelStatus = boolean | null;
export type ScrapedStation = {
  externalSource: typeof BENZIN_SOURCE;
  externalKey: string;
  stationStatus: "available" | "partial" | "unavailable" | "unknown";
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

export type ScrapedReport = {
  externalId: string;
  stationExternalKey: string;
  status: "available" | "partial" | "unavailable" | "unknown";
  fuelType: string | null;
  fuelTypes: string[];
  queue: number | null;
  queueText: string | null;
  labels: string[];
  rawText: string | null;
  queueStatus: string | null;
  partialReason: string | null;
  isCorrected: boolean | null;
  comment: string | null;
  isOnSite: boolean | null;
  isReliable: boolean | null;
  isCounted: boolean | null;
  source: typeof BENZIN_SOURCE;
  createdAt: string;
  importedAt: string;
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

type PublicApiReport = {
  id: number;
  status: string;
  fuelTypes?: unknown;
  limitLiters?: unknown;
  canister?: unknown;
  queue?: unknown;
  queueStatus?: unknown;
  queueText?: unknown;
  labels?: unknown;
  rawText?: unknown;
  comment?: unknown;
  createdAt: number;
  counted?: unknown;
  authorVerified?: unknown;
  geoTrust?: unknown;
};

type Tile = { south: number; west: number; north: number; east: number; depth: number };

export type BenzinScrapeOptions = {
  mode?: "city" | "russia";
  reportsMode?: "incremental" | "backfill";
  bounds: string;
  maxStations: number;
  latitude: number;
  longitude: number;
  city: string;
  gridStepDegrees?: number;
  requestDelayMs?: number;
  reportSinceMs?: number;
  maxReportStationRequests?: number;
  reportCursors?: ReadonlyMap<string, number>;
  onProgress?: (progress: { requests: number; tiles: number; stations: number; duplicates: number }) => void;
};

export type BenzinScrapeResult = {
  stations: ScrapedStation[];
  reports: ScrapedReport[];
  duplicatesDiscarded: number;
  httpStatus: number;
  requestCount: number;
  reportRequestCount: number;
  reportStationCount: number;
  reportCandidatesSkipped: number;
  reportErrors: string[];
  reportCursors: Array<{ stationExternalKey: string; lastReportAt: string }>;
  tilesProcessed: number;
  truncatedTiles: number;
  outsideRussiaDiscarded: number;
  durationMs: number;
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

function parseBounds(value: string): Tile {
  const [south, west, north, east, ...rest] = value.split(",").map(Number);
  if (rest.length || [south, west, north, east].some((coordinate) => !Number.isFinite(coordinate)) || south >= north) {
    throw new Error("Некорректный SCRAPER_BOUNDS: ожидаются latMin,lngMin,latMax,lngMax");
  }
  return { south, west, north, east, depth: 0 };
}

function longitudeRanges(west: number, east: number) {
  return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
}

function createGrid(bounds: Tile, step: number) {
  const tiles: Tile[] = [];
  for (const [westEdge, eastEdge] of longitudeRanges(bounds.west, bounds.east)) {
    for (let south = bounds.south; south < bounds.north; south += step) {
      for (let west = westEdge; west < eastEdge; west += step) {
        tiles.push({
          south,
          west,
          north: Math.min(bounds.north, south + step),
          east: Math.min(eastEdge, west + step),
          depth: 0,
        });
      }
    }
  }
  return tiles;
}

function splitTile(tile: Tile) {
  const middleLatitude = (tile.south + tile.north) / 2;
  const middleLongitude = (tile.west + tile.east) / 2;
  const depth = tile.depth + 1;
  return [
    { south: tile.south, west: tile.west, north: middleLatitude, east: middleLongitude, depth },
    { south: tile.south, west: middleLongitude, north: middleLatitude, east: tile.east, depth },
    { south: middleLatitude, west: tile.west, north: tile.north, east: middleLongitude, depth },
    { south: middleLatitude, west: middleLongitude, north: tile.north, east: tile.east, depth },
  ];
}

function tileIntersectsRussia(tile: Tile) {
  const tilePolygon = polygon([[[
    tile.west, tile.south,
  ], [
    tile.east, tile.south,
  ], [
    tile.east, tile.north,
  ], [
    tile.west, tile.north,
  ], [
    tile.west, tile.south,
  ]]]);
  return booleanIntersects(tilePolygon, RUSSIA_FEATURE);
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function fuelStatus(raw: PublicApiStation, key: string): FuelStatus {
  if (raw.status === "none") return false;
  const fuels = new Set(raw.fuelTypes || []);
  return fuels.size ? fuels.has(key) : null;
}

function reportStatus(status: string): ScrapedReport["status"] {
  if (status === "available") return "available";
  if (status === "limited") return "partial";
  if (status === "none") return "unavailable";
  return "unknown";
}

function stationStatus(status: string): ScrapedStation["stationStatus"] {
  return reportStatus(status);
}

function normalizeFuelTypes(value: unknown) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["ai92", "ai95", "ai98", "ai100", "dt", "gas"]);
  return [...new Set(value.filter((fuel): fuel is string => typeof fuel === "string" && allowed.has(fuel)))];
}

const donorFuelLabels: Record<string, string> = {
  ai92: "АИ-92",
  ai95: "АИ-95",
  ai98: "АИ-98",
  ai100: "АИ-100",
  dt: "ДТ",
  gas: "Газ",
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeQueueStatus(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const normalized = normalizeText(text);
  if (["small", "low", "short", "minor", "небольшая очередь", "небольшая"].includes(normalized)) return "small";
  if (["large", "high", "long", "big", "большая очередь", "большая"].includes(normalized)) return "large";
  if (["none", "no", "noqueue", "без очереди", "нет очереди"].includes(normalized)) return "none";
  return text;
}

function queueStatusLabel(value: string | null) {
  if (value === "small") return "Небольшая очередь";
  if (value === "large") return "Большая очередь";
  if (value === "none") return "Без очереди";
  return value;
}

function normalizeLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => stringValue(label) ? [stringValue(label)!] : []);
}

function reportStatusLabel(status: ScrapedReport["status"]) {
  if (status === "available") return "Есть топливо";
  if (status === "partial") return "Мало топлива";
  if (status === "unavailable") return "Нет топлива";
  return "Нет данных";
}

function reportBadges(rawReport: PublicApiReport, status: ScrapedReport["status"], fuelTypes: string[]) {
  const labels = new Set<string>(normalizeLabels(rawReport.labels));
  labels.add(reportStatusLabel(status));
  for (const fuel of fuelTypes) labels.add(donorFuelLabels[fuel] || fuel.toUpperCase());

  const limitLiters = numberValue(rawReport.limitLiters);
  const canister = stringValue(rawReport.canister);
  const queueStatus = normalizeQueueStatus(rawReport.queueStatus ?? rawReport.queue);
  const queueText = stringValue(rawReport.queueText) || queueStatusLabel(queueStatus);
  let partialReason: string | null = null;

  if (status === "partial") {
    partialReason = fuelTypes.length > 0 ? "Отдельные марки" : "Мало топлива";
    labels.add(partialReason);
  }
  if (limitLiters !== null) {
    labels.add(`лимит ${limitLiters} л`);
    partialReason = partialReason ? `${partialReason}; лимит ${limitLiters} л` : `лимит ${limitLiters} л`;
  }
  if (canister === "yes") labels.add("можно в канистру");
  if (canister === "no") labels.add("только в бак");
  if (queueText) labels.add(queueText);
  if (rawReport.geoTrust === "near") labels.add("На месте");
  if (rawReport.authorVerified === true) labels.add("Надёжный");
  if (rawReport.counted === false) labels.add("исправлено");

  const rawText = [
    ...labels,
    stringValue(rawReport.comment),
  ].filter(Boolean).join(" · ") || null;

  return {
    labels: [...labels],
    rawText,
    queueStatus,
    queueText,
    partialReason,
    isCorrected: typeof rawReport.counted === "boolean" ? rawReport.counted === false : null,
    isReliable: typeof rawReport.authorVerified === "boolean" ? rawReport.authorVerified : null,
  };
}

export async function fetchBenzinStations(options: BenzinScrapeOptions): Promise<BenzinScrapeResult> {
  const startedAt = Date.now();
  const mode = options.mode || "city";
  const gridStep = Math.max(0.5, Math.min(10, options.gridStepDegrees || 4));
  const requestDelayMs = Math.max(100, Math.min(5_000, options.requestDelayMs ?? 250));
  const maxStations = Math.max(100, Math.min(5_000, options.maxStations));
  const reportSinceMs = options.reportSinceMs ?? 0;
  const bounds = mode === "russia" ? { ...RUSSIA_BOUNDS, depth: 0 } : parseBounds(options.bounds);
  if (!Number.isFinite(options.latitude) || !Number.isFinite(options.longitude)) {
    throw new Error("Некорректные координаты SCRAPER_CITY_CENTER_LAT/LNG");
  }

  const pendingTiles = mode === "russia" ? createGrid(bounds, gridStep).filter(tileIntersectsRussia) : [bounds];
  const stations: ScrapedStation[] = [];
  const reports: ScrapedReport[] = [];
  const reportCandidates = new Map<number, { lastReportAt: number; hasCursor: boolean }>();
  const ids = new Set<number>();
  const coordinates = new Set<string>();
  const nameAddresses = new Set<string>();
  const importedAt = new Date().toISOString();
  let duplicatesDiscarded = 0;
  let requestCount = 0;
  let reportRequestCount = 0;
  let tilesProcessed = 0;
  let truncatedTiles = 0;
  let outsideRussiaDiscarded = 0;
  const reportErrors: string[] = [];

  const requestTile = async (tile: Tile) => {
    if (requestCount > 0) await sleep(requestDelayMs);
    requestCount += 1;
    const url = new URL(API_URL);
    url.searchParams.set("bbox", [tile.south, tile.west, tile.north, tile.east].join(","));
    url.searchParams.set("limit", String(maxStations));
    url.searchParams.set("queues", "1");
    url.searchParams.set("center", `${(tile.west + tile.east) / 2},${(tile.south + tile.north) / 2}`);
    return withRetry(async () => {
      const response = await fetch(url, {
        headers: { accept: "application/json", referer: "https://map.benzin-status.tech/", "user-agent": "Mozilla/5.0 (compatible; benzin-status-mvp/1.0; low-rate public-data import)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 403 || response.status === 429) {
        throw new ProtectionDetectedError(`Сайт вернул HTTP ${response.status}; scraper остановлен без обхода защиты.`);
      }
      if (!response.ok) throw new Error(`Публичный stations API вернул HTTP ${response.status}`);
      const json = await response.json() as { stations?: unknown } | unknown[];
      const rows = Array.isArray(json) ? json : json.stations;
      if (!Array.isArray(rows)) throw new Error("Публичный stations API вернул неожиданный формат");
      return rows as PublicApiStation[];
    });
  };

  while (pendingTiles.length) {
    const tile = pendingTiles.shift()!;
    const rows = await requestTile(tile);
    const latitudeSpan = tile.north - tile.south;
    const longitudeSpan = tile.east - tile.west;
    if (rows.length >= maxStations && (latitudeSpan > MIN_TILE_STEP || longitudeSpan > MIN_TILE_STEP)) {
      pendingTiles.unshift(...splitTile(tile).filter((child) => mode !== "russia" || tileIntersectsRussia(child)));
      continue;
    }
    if (rows.length >= maxStations) truncatedTiles += 1;
    tilesProcessed += 1;

    for (const raw of rows) {
      if (!Number.isFinite(raw.id) || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) continue;
      if (mode === "russia" && !booleanPointInPolygon([raw.lng, raw.lat], RUSSIA_FEATURE)) {
        outsideRussiaDiscarded += 1;
        continue;
      }
      const name = raw.name || raw.brand || `АЗС ${raw.id}`;
      const address = raw.address || `Точка ${raw.lat.toFixed(5)}, ${raw.lng.toFixed(5)}`;
      const coordinateKey = `${raw.lat.toFixed(5)}|${raw.lng.toFixed(5)}`;
      const nameAddressKey = `${normalizeText(name)}|${normalizeText(address)}`;
      if (ids.has(raw.id) || coordinates.has(coordinateKey) || nameAddresses.has(nameAddressKey)) {
        duplicatesDiscarded += 1;
        continue;
      }
      ids.add(raw.id);
      coordinates.add(coordinateKey);
      nameAddresses.add(nameAddressKey);
      stations.push({
        externalSource: BENZIN_SOURCE, externalKey: String(raw.id), city: mode === "russia" ? "Россия" : options.city,
        stationStatus: stationStatus(raw.status),
        name, address, brand: raw.brand || name, latitude: raw.lat, longitude: raw.lng,
        ai92: fuelStatus(raw, "ai92"), ai95: fuelStatus(raw, "ai95"), diesel: fuelStatus(raw, "dt"), gas: fuelStatus(raw, "gas"),
        hasQueue: typeof raw.q === "number" ? raw.q > 0 : null,
        sourceUpdatedAt: raw.lastReportAt ? new Date(raw.lastReportAt).toISOString() : null,
        importedAt, rawText: JSON.stringify(raw),
      });
      if (raw.lastReportAt == null) continue;
      const reportCursor = options.reportCursors?.get(String(raw.id));
      const hasCursor = reportCursor !== undefined;
      const shouldFetchReports = options.reportsMode === "backfill"
        ? !hasCursor || raw.lastReportAt > reportCursor
        : !hasCursor
        ? raw.lastReportAt >= reportSinceMs
        : raw.lastReportAt > reportCursor;
      if (shouldFetchReports) {
        reportCandidates.set(raw.id, { lastReportAt: raw.lastReportAt, hasCursor });
      }
    }
    if (requestCount % 25 === 0 || pendingTiles.length === 0) {
      options.onProgress?.({ requests: requestCount, tiles: tilesProcessed, stations: stations.length, duplicates: duplicatesDiscarded });
    }
  }

  const candidates = [...reportCandidates.entries()].sort((left, right) => {
    if (options.reportsMode === "backfill" && left[1].hasCursor !== right[1].hasCursor) {
      return left[1].hasCursor ? 1 : -1;
    }
    return right[1].lastReportAt - left[1].lastReportAt;
  });
  const reportRequestLimit = Math.max(1, Math.min(10_000, options.maxReportStationRequests ?? 2_000));
  const processedCandidates = candidates.slice(0, reportRequestLimit);
  const successfulCandidates: Array<[number, number]> = [];
  for (const [stationId] of processedCandidates) {
    await sleep(requestDelayMs);
    reportRequestCount += 1;
    let detail: { reports?: unknown };
    try {
      detail = await withRetry(async () => {
        const response = await fetch(`${STATION_DETAIL_URL}/${stationId}`, {
          headers: { accept: "application/json", referer: "https://map.benzin-status.tech/", "user-agent": "Mozilla/5.0 (compatible; benzin-status-mvp/1.0; low-rate public-data import)" },
          signal: AbortSignal.timeout(30_000),
        });
        if (response.status === 403 || response.status === 429) {
          throw new ProtectionDetectedError(`Сайт вернул HTTP ${response.status}; scraper остановлен без обхода защиты.`);
        }
        if (!response.ok) throw new Error(`Публичный station detail API вернул HTTP ${response.status}`);
        return response.json() as Promise<{ reports?: unknown }>;
      });
    } catch (error) {
      if (error instanceof ProtectionDetectedError) throw error;
      reportErrors.push(`station ${stationId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!Array.isArray(detail.reports)) {
      reportErrors.push(`station ${stationId}: detail API не вернул массив reports`);
      continue;
    }
    successfulCandidates.push([stationId, reportCandidates.get(stationId)!.lastReportAt]);
    for (const rawReport of detail.reports as PublicApiReport[]) {
      if (!Number.isFinite(rawReport.id) || !Number.isFinite(rawReport.createdAt)) continue;
      const stationCursor = options.reportCursors?.get(String(stationId));
      if (options.reportsMode !== "backfill") {
        const stationCutoff = stationCursor ?? 0;
        if (stationCursor == null ? rawReport.createdAt < stationCutoff : rawReport.createdAt <= stationCutoff) continue;
      }
      const fuelTypes = normalizeFuelTypes(rawReport.fuelTypes);
      const status = reportStatus(rawReport.status);
      const badges = reportBadges(rawReport, status, fuelTypes);
      reports.push({
        externalId: String(rawReport.id),
        stationExternalKey: String(stationId),
        status,
        fuelType: fuelTypes.length === 1 ? fuelTypes[0] : null,
        fuelTypes,
        queue: numberValue(rawReport.queue),
        queueText: badges.queueText,
        labels: badges.labels,
        rawText: badges.rawText,
        queueStatus: badges.queueStatus,
        partialReason: badges.partialReason,
        isCorrected: badges.isCorrected,
        comment: typeof rawReport.comment === "string" && rawReport.comment.trim() ? rawReport.comment.trim() : null,
        isOnSite: rawReport.geoTrust === "near" ? true : typeof rawReport.geoTrust === "string" ? false : null,
        isReliable: badges.isReliable,
        isCounted: typeof rawReport.counted === "boolean" ? rawReport.counted : null,
        source: BENZIN_SOURCE,
        createdAt: new Date(rawReport.createdAt).toISOString(),
        importedAt,
      });
    }
  }

  const uniqueReports = [...new Map(reports.map((report) => [report.externalId, report])).values()];

  return {
    stations, reports: uniqueReports, duplicatesDiscarded, httpStatus: 200, requestCount,
    reportRequestCount, reportStationCount: processedCandidates.length,
    reportCandidatesSkipped: candidates.length - processedCandidates.length,
    reportErrors,
    reportCursors: successfulCandidates.map(([stationId, lastReportAt]) => ({ stationExternalKey: String(stationId), lastReportAt: new Date(lastReportAt).toISOString() })),
    tilesProcessed, truncatedTiles, outsideRussiaDiscarded,
    durationMs: Date.now() - startedAt,
  };
}
