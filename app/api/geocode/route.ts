import { NextResponse } from "next/server";
import { publicCacheHeaders } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";
const GEOCODE_CACHE_HEADERS = publicCacheHeaders({
  browserMaxAge: 86_400,
  edgeMaxAge: 86_400,
  staleWhileRevalidate: 604_800,
});

type NominatimPlace = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  addresstype?: string;
  boundingbox?: string[];
  address?: Record<string, string>;
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 100) return NextResponse.json({ places: [] });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "ru");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "ru");
  url.searchParams.set("limit", "6");
  url.searchParams.set("layer", "address");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "EstToplivo/1.0 (city search for fuel map)", Accept: "application/json" },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return NextResponse.json({ error: "Сервис поиска временно недоступен" }, { status: 502 });
    const data = await response.json() as NominatimPlace[];
    const places = data.map((place) => ({
        id: String(place.place_id),
        name: place.name || place.address?.city || place.address?.town || place.address?.village || place.display_name.split(",")[0],
        description: place.display_name,
        type: place.addresstype ?? place.type ?? "place",
        latitude: Number(place.lat),
        longitude: Number(place.lon),
        boundingBox: place.boundingbox?.map(Number),
      }));
    return NextResponse.json({ places }, { headers: GEOCODE_CACHE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Не удалось выполнить поиск" }, { status: 502 });
  }
}
