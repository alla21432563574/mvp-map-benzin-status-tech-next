"use client";

import { Clock3, Flag, MapPin, Navigation, Share2, Star, X } from "lucide-react";
import { brandInitials, relativeTime } from "@/lib/map-utils";
import { filterFuelKeys, filterFuelLabels, type Station } from "@/lib/types";

export default function StationCard({ station, favorite, now, onClose, onReport, onFavorite, onShare }: { station: Station; favorite: boolean; now: number; onClose: () => void; onReport: () => void; onFavorite: () => void; onShare: () => void }) {
  const routeUrl = `https://yandex.ru/maps/?rtext=~${station.latitude},${station.longitude}&rtt=auto`;
  return (
    <aside className="station-detail absolute bottom-3 left-3 right-3 z-[650] max-h-[calc(100%-120px)] overflow-y-auto rounded-[26px] bg-white p-5 shadow-soft dark:border dark:border-white/10 dark:bg-[#19241e] sm:bottom-5 sm:left-auto sm:right-5 sm:w-[420px] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-forest text-xs font-black text-lime">{brandInitials(station.brand)}</span>
        <div className="min-w-0 flex-1"><span className="text-[11px] font-bold uppercase tracking-[.14em] text-forest dark:text-lime">{station.brand || "АЗС"}</span><h2 className="mt-1 text-xl font-black leading-tight dark:text-white">{station.name}</h2><p className="mt-1.5 flex items-start gap-1.5 text-sm leading-snug text-ink/50 dark:text-white/50"><MapPin className="mt-0.5 shrink-0" size={14} />{station.address || "Адрес не указан"}</p></div>
        <button onClick={onClose} className="rounded-full bg-cream p-2 text-ink/55 hover:text-ink dark:bg-white/10 dark:text-white/55 dark:hover:text-white" aria-label="Закрыть карточку"><X size={18} /></button>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {filterFuelKeys.map((fuel) => {
          const value = station[fuel];
          return <div key={fuel} className={`rounded-xl px-2 py-3 text-center ${value ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : value === false ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300" : "bg-cream text-ink/40 dark:bg-white/5 dark:text-white/40"}`}><div className={`mx-auto mb-1.5 h-2 w-2 rounded-full ${value ? "bg-emerald-500" : value === false ? "bg-red-500" : "bg-ink/20 dark:bg-white/20"}`} /><span className="block text-xs font-bold">{filterFuelLabels[fuel]}</span><small className="mt-0.5 block text-[10px]">{value ? "есть" : value === false ? "нет" : "нет данных"}</small></div>;
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-cream px-3 py-2.5 text-xs text-ink/45 dark:bg-white/5 dark:text-white/45"><span className="flex items-center gap-1.5"><Clock3 size={13} />Обновлено {relativeTime(station.updated_at, now)}</span><span className="truncate">{station.update_source}</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <a href={routeUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-forest px-2 py-3 text-xs font-bold text-white transition hover:bg-ink"><Navigation size={17} />Маршрут</a>
        <button onClick={onFavorite} className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-xs font-bold transition ${favorite ? "bg-amber-100 text-amber-700" : "bg-cream hover:bg-amber-50 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"}`}><Star size={17} fill={favorite ? "currentColor" : "none"} />Избранное</button>
        <button onClick={onShare} className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-cream px-2 py-3 text-xs font-bold transition hover:bg-forest/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"><Share2 size={17} />Поделиться</button>
      </div>
      <button onClick={onReport} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-ink/10 px-5 py-3 text-sm font-bold text-ink/60 transition hover:bg-cream dark:border-white/10 dark:text-white/60 dark:hover:bg-white/5"><Flag size={15} />Сообщить статус</button>
    </aside>
  );
}
