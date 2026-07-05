import { NextResponse } from "next/server";
import { distanceKm } from "@/lib/map-utils";
import { createPublicClient } from "@/lib/supabase";
import type { Station } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 20;

function numberParam(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function searchRank(station: Station, query: string, latitude: number | null, longitude: number | null) {
  const normalized = query.toLocaleLowerCase("ru");
  const brand = station.brand.toLocaleLowerCase("ru");
  const name = station.name.toLocaleLowerCase("ru");
  const exactBrand = brand === normalized ? 0 : 1;
  const startsWith = brand.startsWith(normalized) || name.startsWith(normalized) ? 0 : 1;
  const distance = latitude !== null && longitude !== null ? distanceKm({ latitude, longitude }, station) : Number.POSITIVE_INFINITY;
  return { exactBrand, startsWith, distance };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().replace(/[,()'"%_\\]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  if (query.length < 2) return NextResponse.json({ stations: [] });

  const supabase = createPublicClient();
  if (!supabase) return NextResponse.json({ stations: [], error: "Supabase не настроен" }, { status: 503 });

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || 10));
  const latitude = numberParam(params.get("lat"));
  const longitude = numberParam(params.get("lng"));
  const near = Math.min(5, Math.max(0, Number(params.get("near")) || 0));
  const startedAt = performance.now();
  const tokens = query.split(" ").filter((token) => token.length >= 2).slice(0, 5);

  let stationQuery = supabase
    .from("stations")
    .select("id,name,address,city,latitude,longitude,brand,ai92,ai95,diesel,gas,has_queue,updated_at,update_source")
    .limit(Math.min(MAX_LIMIT * 3, Math.max(limit * 3, 20)));

  if (near > 0 && latitude !== null && longitude !== null) {
    stationQuery = stationQuery
      .gte("latitude", latitude - near)
      .lte("latitude", latitude + near)
      .gte("longitude", longitude - near)
      .lte("longitude", longitude + near);
  }

  for (const token of tokens) {
    const pattern = `*${token}*`;
    stationQuery = stationQuery.or(`name.ilike.${pattern},brand.ilike.${pattern},city.ilike.${pattern},address.ilike.${pattern}`);
  }

  const { data, error } = await stationQuery;
  if (error) return NextResponse.json({ error: `Ошибка поиска АЗС: ${error.message}` }, { status: 500 });

  const stations = (data as Station[])
    .map((station) => ({ station, rank: searchRank(station, query, latitude, longitude) }))
    .sort((left, right) => left.rank.exactBrand - right.rank.exactBrand || left.rank.startsWith - right.rank.startsWith || left.rank.distance - right.rank.distance || new Date(right.station.updated_at).getTime() - new Date(left.station.updated_at).getTime())
    .slice(0, limit)
    .map(({ station }) => station);

  return NextResponse.json({ stations, query, elapsedMs: Math.round(performance.now() - startedAt) }, { headers: { "Cache-Control": "private, max-age=30" } });
}
