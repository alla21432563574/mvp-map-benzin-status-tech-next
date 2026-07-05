"use client";

import { Building2, Fuel, Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { brandOptions, type MapPoint } from "@/lib/map-utils";
import type { Station } from "@/lib/types";

export type GeocodePlace = {
  id: string;
  name: string;
  description: string;
  type: string;
  latitude: number;
  longitude: number;
};

type SearchResult =
  | { id: string; kind: "place"; place: GeocodePlace }
  | { id: string; kind: "station"; station: Station };

type Props = {
  center: MapPoint;
  onPlaceSelect: (place: GeocodePlace) => void;
  onStationSelect: (station: Station) => void;
};

export default function CitySearch({ center, onPlaceSelect, onStationSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const request = useRef<AbortController | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const normalized = value.toLocaleLowerCase("ru");
        const matchedBrand = brandOptions.find((brand) => brand.aliases.some((alias) => normalized.includes(alias)));
        const matchedAlias = matchedBrand?.aliases.find((alias) => normalized.includes(alias));
        const placeQuery = matchedAlias ? value.replace(new RegExp(matchedAlias, "iu"), "").trim() || value : value;
        const suffix = `q=${encodeURIComponent(value)}`;
        const searchCenter = centerRef.current;
        const [stationResponse, placeResponse] = await Promise.all([
          fetch(`/api/search?${suffix}&lat=${searchCenter.latitude}&lng=${searchCenter.longitude}&limit=8`, { signal: controller.signal }),
          fetch(`/api/geocode?q=${encodeURIComponent(placeQuery)}`, { signal: controller.signal }),
        ]);
        const [stationData, placeData] = await Promise.all([stationResponse.json(), placeResponse.json()]);
        const places = (Array.isArray(placeData.places) ? placeData.places : []).map((place: GeocodePlace) => ({ id: `place-${place.id}`, kind: "place" as const, place }));
        let stationRows: Station[] = Array.isArray(stationData.stations) ? stationData.stations : [];
        if (matchedBrand && placeQuery !== value && places[0]) {
          const place = places[0].place;
          const nearbyResponse = await fetch(`/api/search?q=${encodeURIComponent(matchedBrand.label)}&lat=${place.latitude}&lng=${place.longitude}&near=1.5&limit=8`, { signal: controller.signal });
          const nearbyData = await nearbyResponse.json();
          if (Array.isArray(nearbyData.stations)) stationRows = nearbyData.stations;
        }
        const stations = stationRows.map((station: Station) => ({ id: `station-${station.id}`, kind: "station" as const, station }));
        const looksLikeBrand = Boolean(matchedBrand);
        setResults(looksLikeBrand ? [...stations, ...places] : [...places, ...stations]);
        setOpen(true);
        setActiveIndex(0);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const choose = (result: SearchResult) => {
    setOpen(false);
    if (result.kind === "place") {
      setQuery(result.place.name);
      onPlaceSelect(result.place);
    } else {
      setQuery(result.station.name);
      onStationSelect(result.station);
    }
  };

  return (
    <div className="relative w-full">
      <div className="flex h-14 items-center rounded-2xl border border-ink/10 bg-white px-4 shadow-soft transition focus-within:border-forest/40 focus-within:ring-4 focus-within:ring-forest/10 dark:border-white/10 dark:bg-[#19241e] dark:focus-within:border-lime/40 sm:h-16 sm:rounded-[22px]">
        {loading ? <Loader2 className="shrink-0 animate-spin text-forest dark:text-lime" size={21} /> : <Search className="shrink-0 text-forest dark:text-lime" size={21} />}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]); }
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-base font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink/35 dark:text-white dark:placeholder:text-white/35 sm:text-lg"
          placeholder="Город, адрес, АЗС или бренд..."
          aria-label="Поиск города, адреса или АЗС"
          autoComplete="off"
        />
        {query && <button onClick={() => { setQuery(""); setResults([]); setOpen(false); }} className="rounded-full p-1.5 text-ink/35 hover:bg-cream hover:text-ink dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Очистить поиск"><X size={18} /></button>}
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[1000] max-h-[min(430px,65dvh)] overflow-y-auto rounded-2xl border border-ink/5 bg-white py-2 shadow-soft dark:border-white/10 dark:bg-[#19241e]">
          {results.length ? results.map((result, index) => {
            const isPlace = result.kind === "place";
            const title = isPlace ? result.place.name : result.station.name;
            const description = isPlace ? result.place.description : `${result.station.brand} · ${result.station.address || result.station.city || "Адрес не указан"}`;
            const Icon = isPlace ? (result.place.type === "city" || result.place.type === "town" ? Building2 : MapPin) : Fuel;
            return <button key={result.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${index === activeIndex ? "bg-forest/[.08] dark:bg-lime/10" : "hover:bg-cream dark:hover:bg-white/5"}`}>
              <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${isPlace ? "bg-forest/10 text-forest dark:bg-lime/10 dark:text-lime" : "bg-lime text-ink"}`}><Icon size={16} /></span>
              <span className="min-w-0"><b className="block truncate text-sm">{title}</b><small className="mt-0.5 block truncate text-xs text-ink/45 dark:text-white/45">{description}</small><small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-forest dark:text-lime">{isPlace ? "Место" : "АЗС"}</small></span>
            </button>;
          }) : !loading && <p className="px-5 py-5 text-center text-sm text-ink/45 dark:text-white/45">Ничего не найдено. Попробуйте уточнить запрос.</p>}
        </div>
      )}
    </div>
  );
}
