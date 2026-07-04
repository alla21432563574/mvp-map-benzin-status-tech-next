import { NextResponse } from "next/server";
import { demoStations } from "@/lib/demo-data";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const RANGE_SIZE = 1_000;
const MAX_STATIONS = 10_000;

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBbox(value: string | null) {
  if (!value) return null;
  const [west, south, east, north, ...rest] = value.split(",").map(Number);
  if (rest.length || [west, south, east, north].some((coordinate) => !Number.isFinite(coordinate))) return undefined;
  if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) return undefined;
  return { west, south, east, north };
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
  const requestedLimit = Math.min(RANGE_SIZE, parsePositiveInteger(searchParams.get("limit"), RANGE_SIZE));
  const startedAt = performance.now();

  const createQuery = () => {
    let query = supabase.from("stations").select("*");
    if (bbox) {
      query = query
        .gte("longitude", bbox.west)
        .lte("longitude", bbox.east)
        .gte("latitude", bbox.south)
        .lte("latitude", bbox.north);
    }
    return query.order("name").order("id");
  };

  if (requestedPage !== null) {
    const from = (requestedPage - 1) * requestedLimit;
    const { data, error } = await createQuery().range(from, from + requestedLimit - 1);
    if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
    return NextResponse.json({
      stations: data,
      pagination: { page: requestedPage, limit: requestedLimit, returned: data.length, hasMore: data.length === requestedLimit },
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }

  const stations = [];
  for (let from = 0; from < MAX_STATIONS; from += RANGE_SIZE) {
    const { data, error } = await createQuery().range(from, from + RANGE_SIZE - 1);
    if (error) return NextResponse.json({ error: "Не удалось загрузить АЗС" }, { status: 500 });
    stations.push(...data);
    if (data.length < RANGE_SIZE) break;
  }

  return NextResponse.json({
    stations,
    bbox,
    pagination: { returned: stations.length, truncated: stations.length >= MAX_STATIONS },
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}
