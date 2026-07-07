"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Activity, Building2, ChevronDown, Fuel, LocateFixed, Loader2, Map as MapIcon, MapPinned, Moon, ShieldCheck, Sparkles, Star, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { distanceKm, relativeTime, stationBrandId, stationHasFuel, type MapPoint } from "@/lib/map-utils";
import { selectSmartPick } from "@/lib/smart-pick";
import { rankStations, type RankingSignal } from "@/lib/smart-ranking";
import type { FilterFuelKey, MapBounds, Station, StationDetails } from "@/lib/types";
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
  const urlValue = new URLSearchParams(window.location.search).get(key);
  const value = urlValue ?? (key === "fuel" ? localStorage.getItem("last-fuel-filter") : "") ?? "";
  return new Set(value.split(",").filter(Boolean) as T[]);
}

function initialBrandAffinity() {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem("station-brand-affinity") || "{}") as Record<string, number>; }
  catch { return {}; }
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
  const [dataRefreshToken, setDataRefreshToken] = useState(0);
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
  const [stationDetails, setStationDetails] = useState<StationDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [rankingSignals, setRankingSignals] = useState<Map<string, RankingSignal>>(new Map());
  const [rankingLoading, setRankingLoading] = useState(false);
  const [brandAffinity, setBrandAffinity] = useState<Record<string, number>>(initialBrandAffinity);
  const rankingCache = useRef(new Map<string, { signal: RankingSignal; updatedAt: string; expiresAt: number }>());
  const hasLoadedStations = useRef(false);
  const initialLocationCheck = useRef(false);
  const [welcomeState, setWelcomeState] = useState<"checking" | "open" | "closed">("checking");
  const [locationHelpOpen, setLocationHelpOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [smartPickScrollToken, setSmartPickScrollToken] = useState(0);
  const selectedStationId = selected?.id;

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
    const refreshVisibleMap = () => {
      if (document.visibilityState === "visible") setDataRefreshToken((current) => current + 1);
    };
    const timer = window.setInterval(refreshVisibleMap, 120_000);
    document.addEventListener("visibilitychange", refreshVisibleMap);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisibleMap);
    };
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
        hasLoadedStations.current = true;
        setTotalStations(Number(data.pagination?.total ?? data.stations?.length ?? 0));
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") setNotice(error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, hasLoadedStations.current ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [bounds, dataRefreshToken, zoom]);

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
    localStorage.setItem("last-fuel-filter", [...fuels].join(","));
  }, [fuels]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!selectedStationId) {
      setStationDetails(null);
      setDetailsLoading(false);
      return;
    }
    const controller = new AbortController();
    setStationDetails(null);
    setDetailsLoading(true);
    fetch(`/api/stations/${selectedStationId}/reports`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить детали АЗС");
        const reports = Array.isArray(data.reports) ? data.reports : [];
        setStationDetails({
          confidence: Number(data.confidence || 0),
          confidence_status: data.status === "calculated" ? "calculated" : "insufficient",
          confirmation_count: reports.length,
          last_24h_report_count: Number(data.last24hCount || 0),
          unique_confirmers: 0,
          last_confirmation_at: reports[0]?.confirmed_at || selected?.updated_at || new Date().toISOString(),
          source: reports[0]?.source || selected?.update_source || "benzin-status",
          history: reports,
          last_hour_summary: data.summary,
          factors: { freshness: 0, confirmations: 0, consistency: Number(data.confidence || 0) / 100, confirmers: 0, coverage: 0 },
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") setStationDetails(null);
      })
      .finally(() => { if (!controller.signal.aborted) setDetailsLoading(false); });
    return () => controller.abort();
  }, [selected?.update_source, selected?.updated_at, selectedStationId]);

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds((current) => current && current.west === nextBounds.west && current.south === nextBounds.south && current.east === nextBounds.east && current.north === nextBounds.north ? current : nextBounds);
  }, []);
  const handleViewChange = useCallback((nextCenter: MapPoint, nextZoom: number) => {
    setCenter(nextCenter);
    setZoom(nextZoom);
  }, []);

  const brandFiltered = useMemo(() => stations.filter((station) => brands.size === 0 || brands.has(stationBrandId(station))), [brands, stations]);
  const visible = useMemo(() => brandFiltered.filter((station) => !fuels.size || [...fuels].every((fuel) => stationHasFuel(station, fuel))), [brandFiltered, fuels]);

  const rankingCandidates = useMemo(() => {
    const origin = userLocation ?? center;
    return visible.map((station) => ({ station, distance: distanceKm(origin, station) })).sort((left, right) => left.distance - right.distance).slice(0, 250);
  }, [center, userLocation, visible]);
  const rankingCandidateKey = rankingCandidates.map(({ station }) => `${station.id}:${station.updated_at}`).join("|");

  useEffect(() => {
    if (!rankingCandidates.length) { setRankingSignals(new Map()); setRankingLoading(false); return; }
    const cachedSignals = new Map<string, RankingSignal>();
    const missing = rankingCandidates.filter(({ station }) => {
      const cached = rankingCache.current.get(station.id);
      if (cached && cached.updatedAt === station.updated_at && cached.expiresAt > Date.now()) {
        cachedSignals.set(station.id, cached.signal);
        return false;
      }
      return true;
    });
    setRankingSignals(cachedSignals);
    if (!missing.length) { setRankingLoading(false); return; }
    setRankingLoading(true);
    const controller = new AbortController();
    fetch("/api/stations/ranking-signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: missing.map(({ station }) => station.id) }),
      signal: controller.signal,
    }).then((response) => response.json()).then((data) => {
      const next = new Map(cachedSignals);
      for (const { station } of missing) {
        const signal: RankingSignal = data.signals?.[station.id] ?? { confirmationCount: 0, uniqueConfirmers: 0, consistency: 0, lastConfirmationAt: null };
        rankingCache.current.set(station.id, { signal, updatedAt: station.updated_at, expiresAt: Date.now() + 300_000 });
        next.set(station.id, signal);
      }
      setRankingSignals(next);
    }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") setRankingSignals(cachedSignals); })
      .finally(() => { if (!controller.signal.aborted) setRankingLoading(false); });
    return () => controller.abort();
  }, [rankingCandidateKey, rankingCandidates]);

  const listItems = useMemo(() => rankStations(rankingCandidates, { selectedFuels: fuels, brandAffinity, signals: rankingSignals, now }), [brandAffinity, fuels, now, rankingCandidates, rankingSignals]);
  const smartPick = useMemo(() => selectSmartPick(listItems, { selectedFuels: fuels, now }), [fuels, listItems, now]);

  const latestUpdate = useMemo(() => stations.reduce<string | null>((latest, station) => !latest || new Date(station.updated_at) > new Date(latest) ? station.updated_at : latest, null), [stations]);
  const currentAreaCount = fuels.size || brands.size ? visible.length : totalStations;
  const selectedDistance = selected ? distanceKm(userLocation ?? center, selected) : 0;

  const moveTo = (place: GeocodePlace) => {
    setTarget({ latitude: place.latitude, longitude: place.longitude, zoom: 13, token: Date.now() });
    setNotice(`${place.name}: загружаем АЗС поблизости`);
  };

  const selectStation = useCallback((station: Station) => {
    setSelected(station);
    setMobileSheetOpen(true);
    const brandId = stationBrandId(station);
    setBrandAffinity((current) => {
      const next = { ...current, [brandId]: Math.min(50, (current[brandId] || 0) + 1) };
      localStorage.setItem("station-brand-affinity", JSON.stringify(next));
      return next;
    });
  }, []);

  const moveToStation = (station: Station) => {
    selectStation(station);
    setTarget({ latitude: station.latitude, longitude: station.longitude, zoom: 15, token: Date.now() });
  };

  const openSmartPick = () => {
    setSelected(null);
    setMobileSheetOpen(true);
    setSmartPickScrollToken((current) => current + 1);
  };

  const focusSmartPick = (station: Station) => {
    selectStation(station);
    setTarget({ latitude: station.latitude, longitude: station.longitude, zoom: 15, token: Date.now() });
  };

  const moveToCity = (city: typeof QUICK_CITIES[number]) => {
    setSelected(null);
    setTarget({ latitude: city.latitude, longitude: city.longitude, zoom: 12, token: Date.now() });
    setNotice(`${city.name}: загружаем АЗС`);
  };

  const requestLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      localStorage.setItem("hasSeenLocationDialog", "true");
      setWelcomeState("closed");
      setLocationHelpOpen(true);
      return;
    }
    if (navigator.permissions) {
      const permission = await navigator.permissions.query({ name: "geolocation" }).catch(() => null);
      if (permission?.state === "denied") {
        localStorage.setItem("hasSeenLocationDialog", "true");
        setWelcomeState("closed");
        setLocationHelpOpen(true);
        return;
      }
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { latitude: coords.latitude, longitude: coords.longitude };
        setUserLocation(point);
        setTarget({ ...point, zoom: 14, token: Date.now() });
        setMobileSheetOpen(true);
        setLocating(false);
        setWelcomeState("closed");
        setLocationHelpOpen(false);
        localStorage.setItem("hasSeenLocationDialog", "true");
        setNotice("Местоположение найдено. Показываем ближайшие АЗС.");
      },
      () => {
        setLocating(false);
        setWelcomeState("closed");
        setLocationHelpOpen(true);
        localStorage.setItem("hasSeenLocationDialog", "true");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (initialLocationCheck.current) return;
    initialLocationCheck.current = true;
    const seen = localStorage.getItem("hasSeenLocationDialog") === "true";
    if (!navigator.permissions) {
      setWelcomeState(seen ? "closed" : "open");
      return;
    }
    navigator.permissions.query({ name: "geolocation" }).then((permission) => {
      if (permission.state === "granted") requestLocation();
      else if (permission.state === "denied") {
        setWelcomeState("closed");
        if (!seen) {
          localStorage.setItem("hasSeenLocationDialog", "true");
          setLocationHelpOpen(true);
        }
      } else setWelcomeState(seen ? "closed" : "open");
    }).catch(() => setWelcomeState(seen ? "closed" : "open"));
  }, [requestLocation]);

  const chooseCityFromWelcome = () => {
    localStorage.setItem("hasSeenLocationDialog", "true");
    setWelcomeState("closed");
    setLocationHelpOpen(false);
    setSearchFocusToken(Date.now());
  };

  const continueWithoutLocation = () => {
    localStorage.setItem("hasSeenLocationDialog", "true");
    setWelcomeState("closed");
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

  const closeStationDetail = () => {
    setSelected(null);
    setReporting(false);
  };

  const renderStationListPanel = () => <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <FilterPanel fuels={fuels} brands={brands} onFuelsChange={setFuels} onBrandsChange={setBrands} />
    <div className="flex items-center justify-between gap-3 border-b border-ink/8 px-4 py-3 text-xs dark:border-white/10 lg:px-5"><b>{(fuels.size ? visible.length : brandFiltered.length).toLocaleString("ru-RU")} АЗС рядом</b><span className="shrink-0 text-[10px] text-ink/40 dark:text-white/40">Обновлено {latestUpdate ? relativeTime(latestUpdate, now) : "—"}</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto"><StationList items={listItems} smartPick={smartPick} smartPickLoading={rankingLoading} scrollToken={smartPickScrollToken} loading={loading} selectedId={selected?.id ?? null} selectedFuels={fuels} now={now} onSelect={selectStation} onFocusStation={focusSmartPick} /></div>
  </div>;

  const renderStationDetailPanel = () => selected ? <StationCard station={selected} details={stationDetails} detailsLoading={detailsLoading} distance={selectedDistance} favorite={favorites.has(selected.id)} now={now} onClose={closeStationDetail} onReport={() => setReporting(true)} onFavorite={toggleFavorite} onShare={shareStation} /> : null;

  return (
    <main className="h-[100dvh] overflow-hidden bg-cream text-ink transition-colors dark:bg-[#0e1511] dark:text-white lg:p-3">
      <div className="relative flex h-full overflow-hidden bg-white transition-colors dark:bg-[#121b16] lg:rounded-[28px] lg:border lg:border-ink/5 lg:shadow-soft dark:lg:border-white/10">
        <aside className="hidden w-[380px] shrink-0 flex-col border-r border-ink/8 bg-[#fbfcf9] dark:border-white/10 dark:bg-[#121b16] lg:flex">
          <div className="flex items-center justify-between border-b border-ink/8 bg-white px-5 py-5 dark:border-white/10 dark:bg-[#19241e]"><Link href="/" className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-forest text-lime"><Fuel size={22} /></span><span><b className="block text-lg leading-none">Есть топливо</b><small className="mt-1.5 block text-[10px] uppercase tracking-[.16em] text-ink/40 dark:text-white/40">АЗС России</small></span></Link><div className="flex items-center"><button onClick={toggleTheme} className="rounded-full p-2 text-ink/35 hover:bg-cream hover:text-forest dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-lime" aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><Link href="/admin" className="rounded-full p-2 text-ink/35 hover:bg-cream hover:text-forest dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-lime" title="Панель модератора"><ShieldCheck size={19} /></Link></div></div>
          {renderStationListPanel()}
        </aside>

        <aside className={`hidden shrink-0 overflow-hidden border-r border-ink/8 bg-[#fbfcf9] transition-[width,opacity] duration-300 ease-out dark:border-white/10 dark:bg-[#121b16] lg:flex ${selected ? "w-[390px] opacity-100 xl:w-[420px]" : "w-0 opacity-0"}`} aria-hidden={!selected}>
          <div className="h-full w-[390px] shrink-0 xl:w-[420px]">{renderStationDetailPanel()}</div>
        </aside>

        <section className={`relative min-w-0 flex-1 ${mobileSheetOpen || selected ? "mobile-sheet-open" : ""}`}>
          <MapView stations={visible} selectedId={selected?.id ?? null} recommendedId={smartPick.state === "ready" ? smartPick.item.station.id : null} onSelect={selectStation} onBoundsChange={handleBoundsChange} onViewChange={handleViewChange} initialCenter={start.center} initialZoom={start.zoom} target={target} userLocation={userLocation} />

          <div className="pointer-events-none absolute left-3 right-3 top-3 z-[600] sm:left-5 sm:right-5 sm:top-5">
            <div className="pointer-events-auto mx-auto flex max-w-4xl gap-2"><CitySearch center={center} focusToken={searchFocusToken} onPlaceSelect={moveTo} onStationSelect={moveToStation} /><button onClick={requestLocation} disabled={locating} className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-forest px-4 font-bold text-white shadow-soft transition hover:bg-ink disabled:opacity-60 dark:bg-lime dark:text-ink dark:hover:bg-white sm:h-16 sm:rounded-[22px] sm:px-5" aria-label="Моё местоположение">{locating ? <Loader2 className="animate-spin" size={20} /> : <LocateFixed size={20} />}<span className="hidden md:inline">Моё местоположение</span></button><button onClick={toggleTheme} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-ink shadow-soft transition hover:bg-cream dark:bg-[#19241e] dark:text-lime dark:hover:bg-white/10 sm:hidden" aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button></div>
            <div className="pointer-events-auto mx-auto mt-2 flex max-w-4xl gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {QUICK_CITIES.map((city) => <button key={city.name} onClick={() => moveToCity(city)} className="shrink-0 rounded-full border border-ink/5 bg-white/95 px-3 py-1.5 text-[11px] font-bold shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-lime dark:border-white/10 dark:bg-[#19241e]/95 dark:hover:bg-lime dark:hover:text-ink">{city.name}</button>)}
            </div>
            <div className="pointer-events-auto mx-auto mt-1 flex max-w-4xl items-center gap-2">
              <div className="rounded-full bg-white/95 px-3 py-2 text-[11px] font-bold shadow-md backdrop-blur dark:bg-[#19241e]/95 sm:px-4 sm:text-xs"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${loading ? "animate-pulse bg-amber-400" : "bg-emerald-500"}`} />АЗС в текущей области: {currentAreaCount.toLocaleString("ru-RU")}</div>
            </div>
          </div>

          {loading && <div className="pointer-events-none absolute inset-x-0 top-0 z-[550] h-1 overflow-hidden bg-forest/10"><i className="block h-full w-1/3 animate-loading-bar bg-lime" /></div>}

          {!mobileSheetOpen && !selected && <button onClick={openSmartPick} className="absolute bottom-20 left-1/2 z-[560] flex -translate-x-1/2 items-center gap-2 rounded-full border border-ink/10 bg-white/95 px-5 py-3 text-sm font-black text-ink shadow-soft backdrop-blur transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-[#19241e]/95 dark:text-white lg:hidden"><Sparkles size={17} className="text-forest dark:text-lime" />Умный подбор</button>}

          <aside className={`absolute bottom-16 left-0 right-0 z-[500] flex flex-col overflow-hidden rounded-t-[28px] bg-[#fbfcf9] shadow-[0_-12px_40px_rgba(23,35,28,.16)] transition-[height,opacity] duration-300 dark:bg-[#121b16] lg:hidden ${selected ? "h-[78dvh] opacity-100" : mobileSheetOpen ? "h-[70dvh] opacity-100" : "pointer-events-none h-0 opacity-0"}`} aria-hidden={!mobileSheetOpen && !selected}>
            {!selected && <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink/[.07] bg-white px-4 py-2.5 dark:border-white/[.07] dark:bg-[#19241e]"><span className="flex items-center gap-2 text-sm font-black"><Sparkles size={17} className="text-forest dark:text-lime" />Умный подбор</span><button onClick={() => setMobileSheetOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-cream text-ink/50 dark:bg-white/5 dark:text-white/50" aria-label="Свернуть список АЗС"><ChevronDown size={18} /></button></div>}
            {selected ? renderStationDetailPanel() : renderStationListPanel()}
          </aside>

          <nav className="absolute bottom-0 left-0 right-0 z-[530] grid h-16 grid-cols-3 border-t border-ink/[.08] bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-5px_20px_rgba(23,35,28,.08)] backdrop-blur dark:border-white/[.08] dark:bg-[#19241e]/95 lg:hidden" aria-label="Основная навигация">
            <button onClick={() => setNotice("Раздел «Ситуация» появится в следующей версии.")} className="flex flex-col items-center justify-center gap-1 text-[10px] font-bold text-ink/40 dark:text-white/40"><Activity size={19} />Ситуация</button>
            <button onClick={() => { setSelected(null); setMobileSheetOpen(false); }} className="flex flex-col items-center justify-center gap-1 text-[10px] font-black text-forest dark:text-lime"><span className="grid h-8 w-12 place-items-center rounded-full bg-forest/10 dark:bg-lime/10"><MapIcon size={19} /></span>Карта</button>
            <button onClick={() => setNotice("Избранные АЗС доступны через звёздочку в карточке станции.")} className="flex flex-col items-center justify-center gap-1 text-[10px] font-bold text-ink/40 dark:text-white/40"><Star size={19} />Мои АЗС</button>
          </nav>
        </section>
      </div>

      {welcomeState === "open" && <div className="fixed inset-0 z-[2000] grid place-items-center bg-ink/50 p-4 backdrop-blur-[5px]" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <section className="animate-welcome-in w-[min(90vw,500px)] overflow-hidden rounded-[30px] border border-white/40 bg-white p-6 shadow-[0_30px_90px_rgba(0,0,0,.35)] dark:border-white/10 dark:bg-[#19241e] sm:p-8">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-forest text-lime shadow-lg"><MapPinned size={27} /></span>
          <h2 id="welcome-title" className="mt-5 text-2xl font-black leading-tight sm:text-3xl">Найдём ближайшие АЗС</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink/60 dark:text-white/60">Разрешите доступ к местоположению, чтобы сразу показать ближайшие заправки, построить маршрут и отображать расстояние до них.</p>
          <div className="mt-4 rounded-2xl bg-cream p-3 text-xs leading-relaxed text-ink/50 dark:bg-white/5 dark:text-white/50"><b className="block text-ink/75 dark:text-white/75">Ваши координаты остаются приватными</b>Мы не сохраняем их и используем только текущее местоположение устройства.</div>
          <div className="mt-6 space-y-2.5">
            <button onClick={requestLocation} disabled={locating} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-forest px-5 py-4 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-ink disabled:translate-y-0 disabled:opacity-60 dark:bg-lime dark:text-ink dark:hover:bg-white">{locating ? <Loader2 className="animate-spin" size={19} /> : <LocateFixed size={19} />}Определить автоматически</button>
            <button onClick={chooseCityFromWelcome} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-ink/10 bg-white px-5 py-3.5 text-sm font-bold transition hover:bg-cream dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"><Building2 size={18} />Выбрать город</button>
            <button onClick={continueWithoutLocation} className="w-full px-5 py-2.5 text-xs font-bold text-ink/45 transition hover:text-ink dark:text-white/45 dark:hover:text-white">Продолжить без геолокации</button>
          </div>
        </section>
      </div>}

      {locationHelpOpen && welcomeState !== "open" && <div className="fixed bottom-5 left-1/2 z-[1500] w-[min(92vw,460px)] -translate-x-1/2 rounded-2xl border border-ink/10 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-[#19241e]">
        <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><LocateFixed size={17} /></span><div className="min-w-0 flex-1"><b className="text-sm">Не удалось определить местоположение</b><p className="mt-1 text-xs leading-relaxed text-ink/50 dark:text-white/50">Выберите город вручную или разрешите доступ в настройках браузера.</p></div><button onClick={() => setLocationHelpOpen(false)} className="rounded-full p-1 text-ink/35 hover:bg-cream dark:text-white/35 dark:hover:bg-white/10" aria-label="Закрыть уведомление"><X size={15} /></button></div>
        <button onClick={chooseCityFromWelcome} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-black text-white dark:bg-lime dark:text-ink"><Building2 size={15} />Выбрать город</button>
      </div>}

      {notice && <div className="fixed bottom-[40dvh] left-1/2 z-[1200] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-soft lg:bottom-7"><span className="h-2 w-2 shrink-0 rounded-full bg-lime" />{notice}<button onClick={() => setNotice(null)} className="ml-2 opacity-60 hover:opacity-100"><X size={15} /></button></div>}
      {reporting && selected && <ReportModal station={selected} onClose={() => setReporting(false)} />}
    </main>
  );
}
