"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Filter, Fuel, LocateFixed, Menu, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { demoStations } from "@/lib/demo-data";
import { fuelKeys, fuelLabels, type FuelKey, type MapBounds, type Station } from "@/lib/types";
import ReportModal from "./ReportModal";
import StationCard from "./StationCard";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-[#e7ece5] text-sm text-ink/50">Загружаем карту…</div> });

export default function HomeMap() {
  const [stations, setStations] = useState<Station[]>(demoStations);
  const [selected, setSelected] = useState<Station | null>(null);
  const [reporting, setReporting] = useState(false);
  const [filters, setFilters] = useState<Record<FuelKey, boolean>>({ ai92: false, ai95: false, diesel: false, gas: false });
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bounds, setBounds] = useState<MapBounds | null>(null);

  useEffect(() => {
    if (!bounds) return;
    const controller = new AbortController();
    const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
    setLoading(true);
    fetch(`/api/stations?bbox=${bbox}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => { if (Array.isArray(data.stations)) setStations(data.stations); })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") console.error("Не удалось загрузить АЗС", error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [bounds]);

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds((current) => current && current.west === nextBounds.west && current.south === nextBounds.south && current.east === nextBounds.east && current.north === nextBounds.north ? current : nextBounds);
  }, []);

  const active = fuelKeys.filter((key) => filters[key]);
  const visible = useMemo(() => active.length ? stations.filter((station) => active.every((fuel) => station[fuel] === true)) : stations, [active.join(","), stations]);

  return (
    <main className="h-[100dvh] overflow-hidden bg-cream p-0 lg:p-3">
      <div className="relative flex h-full overflow-hidden bg-white lg:rounded-[28px] lg:border lg:border-ink/5 lg:shadow-soft">
        <section className={`absolute inset-y-0 left-0 z-[800] w-[292px] bg-white p-5 shadow-soft transition-transform lg:relative lg:z-10 lg:w-[310px] lg:translate-x-0 lg:shadow-none ${panelOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-forest text-lime"><Fuel size={21} /></span><span><b className="block leading-none">Есть топливо</b><small className="mt-1 block text-[11px] uppercase tracking-[.14em] text-ink/40">Карта АЗС</small></span></Link><button className="rounded-full bg-cream p-2 lg:hidden" onClick={() => setPanelOpen(false)} aria-label="Закрыть меню"><X size={18} /></button></div>
          <div className="mt-10 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-ink/40"><Filter size={14} />Фильтр по топливу</div>
          <div className="mt-4 space-y-2">
            {fuelKeys.map((fuel) => <button key={fuel} onClick={() => setFilters((old) => ({ ...old, [fuel]: !old[fuel] }))} className={`flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-sm font-bold transition ${filters[fuel] ? "bg-forest text-white" : "bg-cream hover:bg-forest/10"}`}><span>{fuelLabels[fuel]}</span><span className={`grid h-5 w-5 place-items-center rounded-full border ${filters[fuel] ? "border-lime bg-lime text-ink" : "border-ink/15"}`}>{filters[fuel] && "✓"}</span></button>)}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink/40">Несколько фильтров показывают АЗС, где есть все выбранные виды топлива.</p>
          {active.length > 0 && <button onClick={() => setFilters({ ai92: false, ai95: false, diesel: false, gas: false })} className="mt-3 text-xs font-bold text-forest underline underline-offset-4">Сбросить фильтры</button>}
          <div className="mt-8 border-t border-ink/10 pt-6"><p className="text-xs font-bold uppercase tracking-[.14em] text-ink/40">Статус маркера</p><div className="mt-4 space-y-3 text-xs text-ink/60"><p className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#238a55]" />Доступно 3–4 вида</p><p className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#e7a92f]" />Доступно 1–2 вида</p><p className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#da554a]" />Топлива нет</p><p className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#7e8b82]" />Нет свежих данных</p></div></div>
          <Link href="/admin" className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-full border border-ink/10 px-4 py-3 text-xs font-bold text-ink/55 hover:bg-cream"><ShieldCheck size={15} />Панель модератора</Link>
        </section>
        {panelOpen && <button onClick={() => setPanelOpen(false)} className="absolute inset-0 z-[700] bg-ink/25 lg:hidden" aria-label="Закрыть меню" />}
        <section className="relative min-w-0 flex-1">
          <div className="absolute left-3 right-3 top-3 z-[600] flex items-center justify-between gap-2 sm:left-5 sm:right-5 sm:top-5">
            <button onClick={() => setPanelOpen(true)} className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-soft lg:hidden" aria-label="Открыть меню"><Menu size={20} /></button>
            <div className="ml-auto flex items-center gap-2 rounded-full bg-white px-4 py-3 text-xs font-bold shadow-soft"><span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse bg-amber-400" : "bg-forest"}`} />{visible.length} АЗС на карте</div>
          </div>
          <MapView stations={visible} selectedId={selected?.id ?? null} onSelect={(station) => setSelected(station)} onBoundsChange={handleBoundsChange} />
          <button className="absolute bottom-5 left-5 z-[400] hidden h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-soft sm:grid" aria-label="Моё местоположение" title="Моё местоположение"><LocateFixed size={19} /></button>
          {visible.length === 0 && <div className="absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 text-center shadow-soft"><RefreshCw className="mx-auto text-forest" /><h2 className="mt-3 font-bold">АЗС не найдены</h2><p className="mt-1 text-sm text-ink/50">Попробуйте убрать один из фильтров.</p></div>}
          {selected && <StationCard station={selected} onClose={() => setSelected(null)} onReport={() => setReporting(true)} />}
        </section>
      </div>
      {reporting && selected && <ReportModal station={selected} onClose={() => setReporting(false)} />}
    </main>
  );
}
