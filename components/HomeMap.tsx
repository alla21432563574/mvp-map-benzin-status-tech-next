"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Clock3, Fuel, LocateFixed, Loader2, Moon, ShieldCheck, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { distanceKm, relativeTime, stationBrandId, stationHasFuel, type MapPoint } from "@/lib/map-utils";
import type { FilterFuelKey, MapBounds, Station } from "@/lib/types";
import CitySearch, { type GeocodePlace } from "./CitySearch";
import FilterPanel from "./FilterPanel";
import type { MapTarget } from "./MapView";
import ReportModal from "./ReportModal";
import StationCard from "./StationCard";
import StationList from "./StationList";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-[#e7ece5]" /> });
const DEFAULT_CENTER = { latitude: 61, longitude: 90 };
const DEFAULT_ZOOM = 3;
const QUICK_CITIES = [
  { name: "Москва", latitude: 55.7558, longitude: 37.6173 },
  { name: "СПб", latitude: 59.9343, longitude: 30.3351 },
  { name: "Казань", latitude: 55.7961, longitude: 49.1064 },
  { name: "Краснодар", latitude: 45.0355, longitude: 38.9753 },
  { name: "Екатеринбург", latitude: 56.8389, longitude: 60.6057 },
  { name: "Новосибирск", latitude: 55.0084, longitude: 82.9357 },
] as const;

function initialView() {
  if (typeof window === "undefined") return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  const params = new URLSearchParams(window.location.search);
  if (!params.has("lat") || !params.has("lng") || !params.has("z")) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(zoom)
    ? { center: { latitude, longitude }, zoom: Math.min(18, Math.max(2, zoom)) }
    : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

function initialSet<T extends string>(key: string) {
  if (typeof window === "undefined") return new Set<T>();
  return new Set((new URLSearchParams(window.location.search).get(key) ?? "").split(",").filter(Boolean) as T[]);
}

export default function HomeMap() {
  const [start] = useState(initialView);
  const [stations, setStations] = useState<Station[]>([]);
  const [totalStations, setTotalStations] = useState(0);
  const [selected, setSelected] = useState<Station | null>(null);
  const [reporting, setReporting] = useState(false);
  const [fuels, setFuels] = useState<Set<FilterFuelKey>>(() => initialSet<FilterFuelKey>("fuel"));
  const [brands, setBrands] = useState<Set<string>>(() => initialSet<string>("brand"));
  const [loading, setLoading] = useState(true);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [center, setCenter] = useState<MapPoint>(start.center);
  const [zoom, setZoom] = useState(start.zoom);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const [userLocation, setUserLocation] = useState<MapPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try { setFavorites(new Set(JSON.parse(localStorage.getItem("favorite-stations") || "[]") as string[])); } catch { /* ignore damaged local preference */ }
    const savedTheme = localStorage.getItem("map-theme");
    const useDarkTheme = savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(useDarkTheme);
    document.documentElement.classList.toggle("dark", useDarkTheme);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!bounds) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
      const markerLimit = zoom <= 4 ? 500 : zoom <= 7 ? 1_200 : 2_000;
      setLoading(true);
      try {
        const response = await fetch(`/api/stations?bbox=${bbox}&viewport=1&limit=${markerLimit}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить АЗС");
        if (Array.isArray(data.stations)) setStations(data.stations);
        setTotalStations(Number(data.pagination?.total ?? data.stations?.length ?? 0));
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") setNotice(error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [bounds, zoom]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const setOrDelete = (key: string, value: string) => value ? params.set(key, value) : params.delete(key);
      setOrDelete("fuel", [...fuels].join(","));
      setOrDelete("brand", [...brands].join(","));
      params.set("lat", center.latitude.toFixed(5));
      params.set("lng", center.longitude.toFixed(5));
      params.set("z", String(zoom));
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [brands, center, fuels, zoom]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds((current) => current && current.west === nextBounds.west && current.south === nextBounds.south && current.east === nextBounds.east && current.north === nextBounds.north ? current : nextBounds);
  }, []);
  const handleViewChange = useCallback((nextCenter: MapPoint, nextZoom: number) => {
    setCenter(nextCenter);
    setZoom(nextZoom);
  }, []);

  const visible = useMemo(() => stations.filter((station) => {
    if (fuels.size && ![...fuels].every((fuel) => stationHasFuel(station, fuel))) return false;
    return brands.size === 0 || brands.has(stationBrandId(station));
  }), [brands, fuels, stations]);

  const listItems = useMemo(() => {
    const origin = userLocation ?? center;
    const selectedFuels = [...fuels];
    return visible.map((station) => ({ station, distance: distanceKm(origin, station) })).sort((left, right) => {
      const distanceBand = Math.floor(left.distance / 2) - Math.floor(right.distance / 2);
      if (distanceBand) return distanceBand;
      const leftFuelScore = selectedFuels.filter((fuel) => stationHasFuel(left.station, fuel)).length;
      const rightFuelScore = selectedFuels.filter((fuel) => stationHasFuel(right.station, fuel)).length;
      if (leftFuelScore !== rightFuelScore) return rightFuelScore - leftFuelScore;
      const freshness = new Date(right.station.updated_at).getTime() - new Date(left.station.updated_at).getTime();
      if (freshness) return freshness;
      const leftBrand = brands.has(stationBrandId(left.station)) ? 1 : 0;
      const rightBrand = brands.has(stationBrandId(right.station)) ? 1 : 0;
      return rightBrand - leftBrand || left.distance - right.distance;
    });
  }, [brands, center, fuels, userLocation, visible]);

  const latestUpdate = useMemo(() => stations.reduce<string | null>((latest, station) => !latest || new Date(station.updated_at) > new Date(latest) ? station.updated_at : latest, null), [stations]);
  const currentAreaCount = fuels.size || brands.size ? visible.length : totalStations;

  const moveTo = (place: GeocodePlace) => {
    setTarget({ latitude: place.latitude, longitude: place.longitude, zoom: 13, token: Date.now() });
    setNotice(`${place.name}: загружаем АЗС поблизости`);
  };

  const moveToStation = (station: Station) => {
    setSelected(station);
    setTarget({ latitude: station.latitude, longitude: station.longitude, zoom: 15, token: Date.now() });
  };

  const moveToCity = (city: typeof QUICK_CITIES[number]) => {
    setSelected(null);
    setTarget({ latitude: city.latitude, longitude: city.longitude, zoom: 12, token: Date.now() });
    setNotice(`${city.name}: загружаем АЗС`);
  };

  const locate = () => {
    if (!navigator.geolocation) { setNotice("Ваш браузер не поддерживает определение местоположения."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { latitude: coords.latitude, longitude: coords.longitude };
        setUserLocation(point);
        setTarget({ ...point, zoom: 14, token: Date.now() });
        setLocating(false);
        setNotice("Местоположение найдено. Показываем ближайшие АЗС.");
      },
      (error) => {
        const messages: Record<number, string> = { 1: "Доступ к геолокации запрещён. Разрешите его в настройках браузера.", 2: "Не удалось определить местоположение. Попробуйте ещё раз.", 3: "Определение местоположения заняло слишком много времени." };
        setNotice(messages[error.code] || "Не удалось определить местоположение.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  const toggleFavorite = () => {
    if (!selected) return;
    const next = new Set(favorites);
    if (next.has(selected.id)) next.delete(selected.id);
    else next.add(selected.id);
    setFavorites(next);
    localStorage.setItem("favorite-stations", JSON.stringify([...next]));
  };

  const toggleTheme = () => {
    setDark((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("map-theme", next ? "dark" : "light");
      return next;
    });
  };

  const shareStation = async () => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("lat", selected.latitude.toFixed(5));
    url.searchParams.set("lng", selected.longitude.toFixed(5));
    url.searchParams.set("z", "16");
    const data = { title: selected.name, text: `${selected.brand} — ${selected.address}`, url: url.toString() };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(data.url);
        setNotice("Ссылка на АЗС скопирована");
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") setNotice("Не удалось поделиться ссылкой");
    }
  };

  const sidebar = <>
    <FilterPanel fuels={fuels} brands={brands} onFuelsChange={setFuels} onBrandsChange={setBrands} />
    <div className="flex items-center justify-between border-b border-ink/8 px-4 py-3 text-xs dark:border-white/10 lg:px-5"><b>{visible.length.toLocaleString("ru-RU")} АЗС рядом</b><span className="text-ink/40 dark:text-white/40">умная сортировка</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto"><StationList items={listItems} loading={loading} selectedId={selected?.id ?? null} selectedFuels={fuels} now={now} onSelect={setSelected} /></div>
  </>;

  return (
    <main className="h-[100dvh] overflow-hidden bg-cream text-ink transition-colors dark:bg-[#0e1511] dark:text-white lg:p-3">
      <div className="relative flex h-full overflow-hidden bg-white transition-colors dark:bg-[#121b16] lg:rounded-[28px] lg:border lg:border-ink/5 lg:shadow-soft dark:lg:border-white/10">
        <aside className="hidden w-[380px] shrink-0 flex-col border-r border-ink/8 bg-[#fbfcf9] dark:border-white/10 dark:bg-[#121b16] lg:flex">
          <div className="flex items-center justify-between border-b border-ink/8 bg-white px-5 py-5 dark:border-white/10 dark:bg-[#19241e]"><Link href="/" className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-forest text-lime"><Fuel size={22} /></span><span><b className="block text-lg leading-none">Есть топливо</b><small className="mt-1.5 block text-[10px] uppercase tracking-[.16em] text-ink/40 dark:text-white/40">АЗС России</small></span></Link><div className="flex items-center"><button onClick={toggleTheme} className="rounded-full p-2 text-ink/35 hover:bg-cream hover:text-forest dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-lime" aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><Link href="/admin" className="rounded-full p-2 text-ink/35 hover:bg-cream hover:text-forest dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-lime" title="Панель модератора"><ShieldCheck size={19} /></Link></div></div>
          {sidebar}
        </aside>

        <section className="relative min-w-0 flex-1">
          <MapView stations={visible} selectedId={selected?.id ?? null} onSelect={setSelected} onBoundsChange={handleBoundsChange} onViewChange={handleViewChange} initialCenter={start.center} initialZoom={start.zoom} target={target} userLocation={userLocation} />

          <div className="pointer-events-none absolute left-3 right-3 top-3 z-[600] sm:left-5 sm:right-5 sm:top-5">
            <div className="pointer-events-auto mx-auto flex max-w-4xl gap-2"><CitySearch center={center} onPlaceSelect={moveTo} onStationSelect={moveToStation} /><button onClick={locate} disabled={locating} className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-forest px-4 font-bold text-white shadow-soft transition hover:bg-ink disabled:opacity-60 dark:bg-lime dark:text-ink dark:hover:bg-white sm:h-16 sm:rounded-[22px] sm:px-5" aria-label="Моё местоположение">{locating ? <Loader2 className="animate-spin" size={20} /> : <LocateFixed size={20} />}<span className="hidden md:inline">Моё местоположение</span></button><button onClick={toggleTheme} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-ink shadow-soft transition hover:bg-cream dark:bg-[#19241e] dark:text-lime dark:hover:bg-white/10 sm:hidden" aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button></div>
            <div className="pointer-events-auto mx-auto mt-2 flex max-w-4xl gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {QUICK_CITIES.map((city) => <button key={city.name} onClick={() => moveToCity(city)} className="shrink-0 rounded-full border border-ink/5 bg-white/95 px-3 py-1.5 text-[11px] font-bold shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-lime dark:border-white/10 dark:bg-[#19241e]/95 dark:hover:bg-lime dark:hover:text-ink">{city.name}</button>)}
            </div>
            <div className="pointer-events-auto mx-auto mt-1 flex max-w-4xl items-center justify-between gap-2">
              <div className="rounded-full bg-white/95 px-3 py-2 text-[11px] font-bold shadow-md backdrop-blur dark:bg-[#19241e]/95 sm:px-4 sm:text-xs"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${loading ? "animate-pulse bg-amber-400" : "bg-emerald-500"}`} />АЗС в текущей области: {currentAreaCount.toLocaleString("ru-RU")}</div>
              <div className="rounded-full bg-white/95 px-3 py-2 text-[11px] shadow-md backdrop-blur dark:bg-[#19241e]/95 sm:px-4 sm:text-xs"><Clock3 className="mr-1.5 inline" size={12} /><span className="hidden sm:inline">Последнее обновление: </span><b>{latestUpdate ? relativeTime(latestUpdate, now) : "нет данных"}</b></div>
            </div>
          </div>

          {loading && <div className="pointer-events-none absolute inset-x-0 top-0 z-[550] h-1 overflow-hidden bg-forest/10"><i className="block h-full w-1/3 animate-loading-bar bg-lime" /></div>}
          {selected && <StationCard station={selected} favorite={favorites.has(selected.id)} now={now} onClose={() => setSelected(null)} onReport={() => setReporting(true)} onFavorite={toggleFavorite} onShare={shareStation} />}

          <aside className="absolute bottom-0 left-0 right-0 z-[500] flex max-h-[38dvh] min-h-[190px] flex-col rounded-t-[28px] bg-[#fbfcf9] shadow-[0_-12px_40px_rgba(23,35,28,.16)] dark:bg-[#121b16] lg:hidden">
            <div className="mx-auto my-2 h-1 w-10 rounded-full bg-ink/15" />
            {sidebar}
          </aside>
        </section>
      </div>

      {notice && <div className="fixed bottom-[40dvh] left-1/2 z-[1200] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-soft lg:bottom-7"><span className="h-2 w-2 shrink-0 rounded-full bg-lime" />{notice}<button onClick={() => setNotice(null)} className="ml-2 opacity-60 hover:opacity-100"><X size={15} /></button></div>}
      {reporting && selected && <ReportModal station={selected} onClose={() => setReporting(false)} />}
    </main>
  );
}
