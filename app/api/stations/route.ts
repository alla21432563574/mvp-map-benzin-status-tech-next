import { NextResponse } from "next/server";
import { demoStations } from "@/lib/demo-data";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const RANGE_SIZE = 1_000;
const MAX_STATIONS = 100_000;
const MAX_VIEWPORT_STATIONS = 2_000;

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

export async function GET(request: Request) {
  const supabase = createPublicClient();
  if (!supabase) return NextResponse.json({ stations: demoStations, demo: true });

  const searchParams = new URL(request.url).searchParams;
  const bbox = parseBbox(searchParams.get("bbox"));
  if (bbox === undefined) {
    return NextResponse.json({ error: "Некорректный bbox. Ожидается west,south,east,north" }, { status: 400 });
  }

  const requestedPage = searchParams.has("page") ? parsePositiveInteger(searchParams.get("page"), 1) : null;
  const viewport = searchParams.get("viewport") === "1";
  const requestedLimit = Math.min(viewport ? MAX_VIEWPORT_STATIONS : RANGE_SIZE, parsePositiveInteger(searchParams.get("limit"), RANGE_SIZE));
  const startedAt = performance.now();

  const createQuery = (range?: { west: number; east: number }) => {
    let query = supabase.from("stations").select("*").eq("is_active", true);
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
      let query = supabase.from("stations").select("*", { count: "exact" }).eq("is_active", true);
      if (bbox) query = query.gte("longitude", range!.west).lte("longitude", range!.east).gte("latitude", bbox.south).lte("latitude", bbox.north);
      const { data, error, count } = await query.order("name").order("id").range(0, requestedLimit - 1);
      if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
      total += count ?? data.length;
      for (const station of data) stationMap.set(String(station.id), station);
    }
    const stations = [...stationMap.values()]
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "ru") || String(left.id).localeCompare(String(right.id)))
      .slice(0, requestedLimit);
    return NextResponse.json({
      stations,
      bbox,
      pagination: { returned: stations.length, total, truncated: stations.length < total },
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }

  for (const range of ranges) {
    for (let from = 0; from < MAX_STATIONS; from += RANGE_SIZE) {
      const { data, error } = await createQuery(range).range(from, from + RANGE_SIZE - 1);
      if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
      for (const station of data) stationMap.set(String(station.id), station);
      if (data.length < RANGE_SIZE) break;
      if (from + RANGE_SIZE >= MAX_STATIONS) truncated = true;
    }
  }
  const allStations = [...stationMap.values()].sort((left, right) =>
    String(left.name || "").localeCompare(String(right.name || ""), "ru") || String(left.id).localeCompare(String(right.id)),
  );
  const pageStart = requestedPage === null ? 0 : (requestedPage - 1) * requestedLimit;
  const stations = requestedPage === null ? allStations : allStations.slice(pageStart, pageStart + requestedLimit);
  total = allStations.length;

  return NextResponse.json({
    stations,
    bbox,
    pagination: requestedPage === null
      ? { returned: stations.length, total, truncated }
      : { page: requestedPage, limit: requestedLimit, returned: stations.length, total, hasMore: pageStart + stations.length < allStations.length },
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}
