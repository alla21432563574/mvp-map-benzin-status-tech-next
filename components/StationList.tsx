"use client";

import { ChevronRight, Clock3, MapPin } from "lucide-react";
import { brandInitials, formatDistance, relativeTime, stationDisplayStatus, type StationStatusKind } from "@/lib/map-utils";
import type { FilterFuelKey, Station } from "@/lib/types";

type Item = { station: Station; distance: number };

const statusClasses: Record<StationStatusKind, string> = {
  available: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  partial: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  unavailable: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  unknown: "bg-ink/5 text-ink/45 dark:bg-white/5 dark:text-white/45",
};

const dotClasses: Record<StationStatusKind, string> = {
  available: "bg-emerald-500",
  partial: "bg-amber-500",
  unavailable: "bg-red-500",
  unknown: "bg-gray-400",
};

type Props = {
  items: Item[];
  loading: boolean;
  selectedId: string | null;
  selectedFuels: ReadonlySet<FilterFuelKey>;
  now: number;
  onSelect: (station: Station) => void;
};

export default function StationList({ items, loading, selectedId, selectedFuels, now, onSelect }: Props) {
  if (loading && !items.length) return <div className="space-y-2 p-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-ink/5 dark:bg-white/5" />)}</div>;
  if (!items.length) return <div className="px-7 py-12 text-center"><MapPin className="mx-auto text-forest/35 dark:text-lime/35" size={30} /><p className="mt-3 font-bold">АЗС не найдены</p><p className="mt-1 text-sm text-ink/45 dark:text-white/45">Измените фильтры или область карты.</p></div>;

  return (
    <div className="space-y-2 p-3">
      {items.slice(0, 150).map(({ station, distance }) => {
        const status = stationDisplayStatus(station, selectedFuels);
        return <button key={station.id} onClick={() => onSelect(station)} className={`group w-full rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${selectedId === station.id ? "border-forest/40 bg-forest/[.06] dark:border-lime/40 dark:bg-lime/[.06]" : "border-ink/[.07] bg-white dark:border-white/[.07] dark:bg-[#19241e]"}`}>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-forest text-[10px] font-black tracking-tight text-lime">{brandInitials(station.brand)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2"><b className="block min-w-0 truncate text-sm leading-tight">{station.brand || station.name || "АЗС"}</b><span className="shrink-0 text-xs font-bold text-forest dark:text-lime">{formatDistance(distance)}</span></span>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses[status.kind]}`}><i className={`h-1.5 w-1.5 rounded-full ${dotClasses[status.kind]}`} />{status.label}</span>
              <span className="mt-2 block truncate text-xs text-ink/45 dark:text-white/45">{station.address || "Адрес не указан"}</span>
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-ink/[.06] pt-2.5 text-[11px] text-ink/40 dark:border-white/[.06] dark:text-white/40"><span className="flex items-center gap-1"><Clock3 size={11} />{relativeTime(station.updated_at, now)}</span><span className="flex items-center gap-1 font-bold text-forest dark:text-lime">Показать <ChevronRight size={13} /></span></div>
        </button>;
      })}
      {items.length > 150 && <p className="py-3 text-center text-xs text-ink/40">Показаны ближайшие 150 из {items.length}</p>}
    </div>
  );
}
