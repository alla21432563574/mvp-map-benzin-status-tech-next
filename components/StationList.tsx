"use client";

import { AlertTriangle, ChevronRight, Clock3, MapPin, Navigation, Sparkles, Star } from "lucide-react";
import { useEffect, useRef } from "react";
import { brandInitials, formatDistance, relativeTime, stationDisplayStatus, type StationStatusKind } from "@/lib/map-utils";
import type { SmartPickResult } from "@/lib/smart-pick";
import type { RankedStation } from "@/lib/smart-ranking";
import type { FilterFuelKey, Station } from "@/lib/types";

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
  items: RankedStation[];
  smartPick: SmartPickResult;
  smartPickLoading: boolean;
  scrollToken: number;
  loading: boolean;
  selectedId: string | null;
  selectedFuels: ReadonlySet<FilterFuelKey>;
  now: number;
  onSelect: (station: Station) => void;
  onFocusStation: (station: Station) => void;
};

function queueLabel(station: Station) {
  if (typeof station.queue_count === "number") return station.queue_count === 0 ? "без очереди" : `очередь: ${station.queue_count} машин`;
  if (station.has_queue === false) return "без очереди";
  if (station.has_queue === true) return "есть очередь";
  return null;
}

function confidenceLabel(confidence: number, confirmationCount: number) {
  return confirmationCount > 1 ? `${confidence}%` : "Недостаточно подтверждений";
}

export default function StationList({ items, smartPick, smartPickLoading, scrollToken, loading, selectedId, selectedFuels, now, onSelect, onFocusStation }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollToken) rootRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scrollToken]);

  if (loading && !items.length) return <div className="space-y-2 p-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-ink/5 dark:bg-white/5" />)}</div>;

  const pickedId = smartPick.state === "ready" ? smartPick.item.station.id : null;
  const smartPickQueue = smartPick.state === "ready" ? queueLabel(smartPick.item.station) : null;
  const regularItems = items.filter((item) => item.station.id !== pickedId);

  return (
    <div ref={rootRef} className="space-y-2 p-3">
      {smartPickLoading ? (
        <section className="mb-3 rounded-[22px] border border-forest/15 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#19241e]">
          <div className="flex items-center gap-2 text-sm font-black"><Sparkles size={17} className="animate-pulse text-forest dark:text-lime" />Подбираем лучший вариант...</div>
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-ink/5 dark:bg-white/5" />
        </section>
      ) : smartPick.state === "ready" ? (
        <section className="smart-pick-card mb-4 overflow-hidden rounded-[24px] border border-emerald-400/70 bg-gradient-to-br from-white via-emerald-50/80 to-lime/20 p-4 shadow-[0_12px_35px_rgba(31,107,69,.16)] dark:from-[#19241e] dark:via-[#173426] dark:to-[#1c442d]">
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-black uppercase tracking-[.1em] text-forest dark:text-lime"><Star size={15} fill="currentColor" />Мы нашли лучший вариант</span><span className="rounded-full bg-forest px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white dark:bg-lime dark:text-ink">Лучший вариант</span></div>
          <button onClick={() => onFocusStation(smartPick.item.station)} className="mt-4 flex w-full items-start gap-3 text-left">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-forest text-[10px] font-black text-lime">{brandInitials(smartPick.item.station.brand)}</span>
            <span className="min-w-0 flex-1"><b className="block truncate text-lg leading-tight">{smartPick.item.station.brand || smartPick.item.station.name || "АЗС"}</b><span className="mt-1 block text-xs font-bold text-forest dark:text-lime">{smartPick.explanation}</span><span className="mt-1.5 block truncate text-xs text-ink/50 dark:text-white/50">{smartPick.item.station.address || "Адрес не указан"}</span></span>
          </button>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <span className="rounded-xl bg-white/75 p-2.5 dark:bg-white/[.06]"><b className="block text-sm">📍 {formatDistance(smartPick.item.distance)}</b><small className="text-ink/45 dark:text-white/45">от вас или центра</small></span>
            <span className="rounded-xl bg-white/75 p-2.5 dark:bg-white/[.06]"><b className="block text-sm text-emerald-700 dark:text-emerald-300">● {confidenceLabel(smartPick.item.confidence, smartPick.item.confirmationCount)}</b><small className="text-ink/45 dark:text-white/45">уверенность</small></span>
            <span className="rounded-xl bg-white/75 p-2.5 dark:bg-white/[.06]"><b className="block truncate text-sm">✅ {stationDisplayStatus(smartPick.item.station, selectedFuels).label}</b><small className="text-ink/45 dark:text-white/45">наличие топлива</small></span>
            {smartPickQueue && <span className="col-span-2 rounded-xl bg-white/75 p-2.5 dark:bg-white/[.06]"><b className="block text-sm">🚗 {smartPickQueue}</b><small className="text-ink/45 dark:text-white/45">ситуация на АЗС</small></span>}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink/50 dark:text-white/50"><Clock3 size={13} />Обновлено {relativeTime(smartPick.item.lastConfirmationAt, now)}</p>
          <a href={`https://yandex.ru/maps/?rtext=~${smartPick.item.station.latitude},${smartPick.item.station.longitude}&rtt=auto`} target="_blank" rel="noreferrer" className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-forest px-4 py-3.5 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-ink dark:bg-lime dark:text-ink dark:hover:bg-white"><Navigation size={17} />Построить маршрут</a>
        </section>
      ) : (
        <section className="mb-4 rounded-[22px] border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-400/[.07]">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={20} /><div><b className="text-sm">Надёжного варианта рядом не найдено</b><p className="mt-1 text-xs leading-relaxed text-ink/55 dark:text-white/55">{smartPick.explanation}</p></div></div>
          <p className="mt-3 text-xs text-ink/45 dark:text-white/45">Увеличьте область карты, измените фильтр топлива или выберите другой город.</p>
        </section>
      )}

      <div className="flex items-center justify-between px-1 pb-1 pt-1"><b className="text-sm">Все АЗС рядом</b><span className="text-[10px] text-ink/40 dark:text-white/40">по полезности</span></div>
      {!items.length && <div className="px-7 py-10 text-center"><MapPin className="mx-auto text-forest/35 dark:text-lime/35" size={30} /><p className="mt-3 font-bold">АЗС не найдены</p><p className="mt-1 text-sm text-ink/45 dark:text-white/45">Выберите город, включите геолокацию или измените область карты.</p></div>}
      {regularItems.slice(0, 150).map(({ station, distance, confidence, confirmationCount, lastConfirmationAt, reason }) => {
        const status = stationDisplayStatus(station, selectedFuels);
        return <button key={station.id} onClick={() => onSelect(station)} className={`group w-full rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${selectedId === station.id ? "border-forest/40 bg-forest/[.06] dark:border-lime/40 dark:bg-lime/[.06]" : "border-ink/[.07] bg-white dark:border-white/[.07] dark:bg-[#19241e]"}`}>
          <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-forest text-[10px] font-black tracking-tight text-lime">{brandInitials(station.brand)}</span><span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="block truncate text-sm leading-tight">{station.brand || station.name || "АЗС"}</b><small className="mt-1 block truncate text-[10px] font-bold text-forest dark:text-lime">{reason}</small></span><span className="shrink-0 text-xs font-bold text-forest dark:text-lime">{formatDistance(distance)}</span></span><span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses[status.kind]}`}><i className={`h-1.5 w-1.5 rounded-full ${dotClasses[status.kind]}`} />{status.label}</span><span className="mt-2 block truncate text-xs text-ink/45 dark:text-white/45">{station.address || "Адрес не указан"}</span></span></div>
          <div className="mt-2.5 flex items-center justify-between border-t border-ink/[.06] pt-2.5 text-[11px] text-ink/40 dark:border-white/[.06] dark:text-white/40"><span className="flex min-w-0 items-center gap-2"><span className="flex shrink-0 items-center gap-1"><Clock3 size={11} />{relativeTime(lastConfirmationAt, now)}</span><span className="truncate">· {confidenceLabel(confidence, confirmationCount)}</span></span><span className="flex shrink-0 items-center gap-1 font-bold text-forest dark:text-lime">Показать <ChevronRight size={13} /></span></div>
        </button>;
      })}
      {items.length > 150 && <p className="py-3 text-center text-xs text-ink/40">Показаны первые 150 из {items.length}</p>}
    </div>
  );
}
