import { NextResponse } from "next/server";
import { publicCacheHeaders } from "@/lib/cache-headers";
import { demoStations } from "@/lib/demo-data";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const RANGE_SIZE = 1_000;
const LATEST_REPORT_CHUNK_SIZE = 250;
const MAX_GLOBAL_PAGE_SIZE = 250;
const MAX_VIEWPORT_STATIONS = 2_000;
const STATIONS_CACHE_HEADERS = publicCacheHeaders({
  browserMaxAge: 10,
  edgeMaxAge: 45,
  staleWhileRevalidate: 120,
});
const STATION_SELECT = [
  "id",
  "city",
  "name",
  "address",
  "latitude",
  "longitude",
  "brand",
  "station_status",
  "ai92",
  "ai95",
  "diesel",
  "gas",
  "has_queue",
  "updated_at",
  "update_source",
].join(",");

type StationRow = Record<string, unknown> & { id: string };
type LatestReportRow = {
  station_id: string;
  status: "available" | "partial" | "unavailable" | "unknown";
  created_at: string;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBbox(value: string | null) {
  if (!value) return null;
  const [west, south, east, north, ...rest] = value.split(",").map(Number);
  if (rest.length || [west, south, east, north].some((coordinate) => !Number.isFinite(coordinate))) return undefined;
  const span = east - west;
  if (span <= 0 || south >= north || south < -90 || north > 90) return undefined;
  const wrap = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180;
  if (span >= 360) return { west, south, east, north, longitudeRanges: [{ west: -180, east: 180 }] };
  const normalizedWest = wrap(west);
  const normalizedEast = wrap(east);
  const longitudeRanges = normalizedWest < normalizedEast
    ? [{ west: normalizedWest, east: normalizedEast }]
    : [{ west: normalizedWest, east: 180 }, { west: -180, east: normalizedEast }];
  return { west, south, east, north, longitudeRanges };
}

function asStationRows(data: unknown): StationRow[] {
  if (!Array.isArray(data)) return [];
  return (data as StationRow[]).map((station) => ({ queue_count: null, ...station }));
}

async function withLatestReportStatus(
  supabase: NonNullable<ReturnType<typeof createPublicClient>>,
  stations: StationRow[],
) {
  if (!stations.length) return stations;
  const stationIds = [...new Set(stations.map((station) => station.id).filter(Boolean))];
  const latestByStation = new Map<string, LatestReportRow>();
  for (let index = 0; index < stationIds.length; index += LATEST_REPORT_CHUNK_SIZE) {
    const ids = stationIds.slice(index, index + LATEST_REPORT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("latest_station_reports")
      .select("station_id,status,created_at")
      .in("station_id", ids);
    if (error || !data) continue;
    for (const report of data as LatestReportRow[]) latestByStation.set(report.station_id, report);
  }
  return stations.map((station) => {
    const latest = latestByStation.get(station.id);
    return latest
      ? { ...station, latest_report_status: latest.status, latest_report_at: latest.created_at }
      : { ...station, latest_report_status: null, latest_report_at: null };
  });
}

export async function GET(request: Request) {
  const supabase = createPublicClient();
  if (!supabase) return NextResponse.json({ stations: demoStations, demo: true }, { headers: STATIONS_CACHE_HEADERS });

  const searchParams = new URL(request.url).searchParams;
  const bbox = parseBbox(searchParams.get("bbox"));
  if (bbox === undefined) {
    return NextResponse.json({ error: "Некорректный bbox. Ожидается west,south,east,north" }, { status: 400 });
  }

  const requestedPage = searchParams.has("page") ? parsePositiveInteger(searchParams.get("page"), 1) : null;
  const viewport = searchParams.get("viewport") === "1";
  const requestedLimit = Math.min(viewport ? MAX_VIEWPORT_STATIONS : RANGE_SIZE, parsePositiveInteger(searchParams.get("limit"), RANGE_SIZE));
  const startedAt = performance.now();

  const json = (body: unknown) => NextResponse.json(body, {
    headers: STATIONS_CACHE_HEADERS,
  });

  if (!bbox) {
    const safeLimit = Math.min(MAX_GLOBAL_PAGE_SIZE, parsePositiveInteger(searchParams.get("limit"), 100));
    const page = requestedPage ?? 1;
    const from = (page - 1) * safeLimit;
    const { data, error } = await supabase
      .from("stations")
      .select(STATION_SELECT)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .order("id")
      .range(from, from + safeLimit - 1);
    if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
    const stations = await withLatestReportStatus(supabase, asStationRows(data));
    return json({
      stations,
      bbox: null,
      pagination: {
        page,
        limit: safeLimit,
        returned: stations.length,
        hasMore: stations.length === safeLimit,
        bboxRequired: true,
      },
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }

  const createQuery = (range?: { west: number; east: number }) => {
    let query = supabase.from("stations").select(STATION_SELECT).eq("is_active", true);
    if (bbox) {
      query = query
        .gte("longitude", range!.west)
        .lte("longitude", range!.east)
        .gte("latitude", bbox.south)
        .lte("latitude", bbox.north);
    }
    return query.order("name").order("id");
  };

  const ranges = bbox?.longitudeRanges || [undefined];
  const stationMap = new Map<string, Record<string, unknown>>();
  let truncated = false;
  let total = 0;

  if (viewport) {
    for (const range of ranges) {
      let query = supabase.from("stations").select(STATION_SELECT, { count: "exact" }).eq("is_active", true);
      if (bbox) query = query.gte("longitude", range!.west).lte("longitude", range!.east).gte("latitude", bbox.south).lte("latitude", bbox.north);
      const { data, error, count } = await query.order("name").order("id").range(0, requestedLimit - 1);
      if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
      const rows = asStationRows(data);
      total += count ?? rows.length;
      for (const station of rows) stationMap.set(String(station.id), station);
    }
    const stations = [...stationMap.values()]
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "ru") || String(left.id).localeCompare(String(right.id)))
      .slice(0, requestedLimit);
    const enrichedStations = await withLatestReportStatus(supabase, stations as StationRow[]);
    return json({
      stations: enrichedStations,
      bbox,
      pagination: { returned: stations.length, total, truncated: stations.length < total },
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }

  for (const range of ranges) {
    for (let from = 0; from < MAX_VIEWPORT_STATIONS; from += RANGE_SIZE) {
      const { data, error } = await createQuery(range).range(from, from + RANGE_SIZE - 1);
      if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
      const rows = asStationRows(data);
      for (const station of rows) stationMap.set(String(station.id), station);
      if (rows.length < RANGE_SIZE) break;
      if (from + RANGE_SIZE >= MAX_VIEWPORT_STATIONS) truncated = true;
    }
  }
  const allStations = [...stationMap.values()].sort((left, right) =>
    String(left.name || "").localeCompare(String(right.name || ""), "ru") || String(left.id).localeCompare(String(right.id)),
  );
  const pageStart = requestedPage === null ? 0 : (requestedPage - 1) * requestedLimit;
  const stations = requestedPage === null ? allStations : allStations.slice(pageStart, pageStart + requestedLimit);
  total = allStations.length;
  const enrichedStations = await withLatestReportStatus(supabase, stations as StationRow[]);

  return json({
    stations: enrichedStations,
    bbox,
    pagination: requestedPage === null
      ? { returned: stations.length, total, truncated }
      : { page: requestedPage, limit: requestedLimit, returned: stations.length, total, hasMore: pageStart + stations.length < allStations.length },
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}
