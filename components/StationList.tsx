"use client";

import { ChevronRight, Clock3, MapPin } from "lucide-react";
import { brandInitials, formatDistance, relativeTime } from "@/lib/map-utils";
import { fuelKeys, fuelLabels, type Station } from "@/lib/types";

type Item = { station: Station; distance: number };

export default function StationList({ items, loading, selectedId, now, onSelect }: { items: Item[]; loading: boolean; selectedId: string | null; now: number; onSelect: (station: Station) => void }) {
  if (loading && !items.length) return <div className="space-y-3 p-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-ink/5 dark:bg-white/5" />)}</div>;
  if (!items.length) return <div className="px-7 py-12 text-center"><MapPin className="mx-auto text-forest/35 dark:text-lime/35" size={30} /><p className="mt-3 font-bold">АЗС не найдены</p><p className="mt-1 text-sm text-ink/45 dark:text-white/45">Измените фильтры или область карты.</p></div>;

  return (
    <div className="space-y-2 p-3 lg:p-4">
      {items.slice(0, 150).map(({ station, distance }) => (
        <button key={station.id} onClick={() => onSelect(station)} className={`group w-full rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${selectedId === station.id ? "border-forest/40 bg-forest/[.06] dark:border-lime/40 dark:bg-lime/[.06]" : "border-ink/[.07] bg-white dark:border-white/[.07] dark:bg-[#19241e]"}`}>
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-forest text-[11px] font-black tracking-tight text-lime">{brandInitials(station.brand)}</span>
            <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><b className="line-clamp-1 text-sm">{station.name}</b><span className="shrink-0 text-xs font-bold text-forest dark:text-lime">{formatDistance(distance)}</span></span><span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-ink/45 dark:text-white/45">{station.address || "Адрес не указан"}</span></span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{fuelKeys.map((fuel) => <span key={fuel} className={`rounded-lg px-2 py-1 text-[10px] font-bold ${station[fuel] ? "bg-emerald-50 text-emerald-700" : station[fuel] === false ? "bg-red-50 text-red-500" : "bg-ink/5 text-ink/35"}`}>{fuelLabels[fuel]}</span>)}</div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink/40 dark:text-white/40"><span className="flex items-center gap-1"><Clock3 size={11} />{relativeTime(station.updated_at, now)}</span><span className="flex items-center gap-1 font-bold text-forest transition dark:text-lime">Показать <ChevronRight size={13} /></span></div>
        </button>
      ))}
      {items.length > 150 && <p className="py-3 text-center text-xs text-ink/40">Показаны ближайшие 150 из {items.length}</p>}
    </div>
  );
}
