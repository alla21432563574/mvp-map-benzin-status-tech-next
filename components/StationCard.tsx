"use client";

import { ArrowLeft, Clock3, Flag, MapPin, Navigation, Share2, Star } from "lucide-react";
import { brandInitials, formatDistance, relativeTime, stationDisplayStatus, type StationStatusKind } from "@/lib/map-utils";
import { filterFuelKeys, filterFuelLabels, type Station, type StationDetails } from "@/lib/types";

const statusStyles: Record<StationStatusKind, { panel: string; dot: string }> = {
  available: { panel: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200", dot: "bg-emerald-500" },
  partial: { panel: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200", dot: "bg-amber-500" },
  unavailable: { panel: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200", dot: "bg-red-500" },
  unknown: { panel: "bg-ink/5 text-ink/55 dark:bg-white/5 dark:text-white/55", dot: "bg-gray-400" },
};

type Props = {
  station: Station;
  details: StationDetails | null;
  detailsLoading: boolean;
  distance: number;
  favorite: boolean;
  now: number;
  onBack: () => void;
  onReport: () => void;
  onFavorite: () => void;
  onShare: () => void;
};

export default function StationCard({ station, details, detailsLoading, distance, favorite, now, onBack, onReport, onFavorite, onShare }: Props) {
  const routeUrl = `https://yandex.ru/maps/?rtext=~${station.latitude},${station.longitude}&rtt=auto`;
  const overall = stationDisplayStatus(station);
  const overallStyle = statusStyles[overall.kind];
  const hasEnoughConfirmations = (details?.confirmation_count ?? 0) > 1;

  return (
    <section className="station-detail flex h-full min-h-0 flex-col bg-[#fbfcf9] dark:bg-[#121b16]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink/[.08] bg-white px-4 dark:border-white/10 dark:bg-[#19241e]">
        <button onClick={onBack} className="flex items-center gap-2 rounded-full px-2 py-2 text-sm font-bold text-forest transition hover:bg-forest/10 dark:text-lime dark:hover:bg-white/10"><ArrowLeft size={18} />Назад</button>
        <button onClick={onFavorite} className={`grid h-9 w-9 place-items-center rounded-full transition ${favorite ? "bg-amber-100 text-amber-600" : "bg-cream text-ink/45 hover:text-amber-600 dark:bg-white/5 dark:text-white/45"}`} aria-label={favorite ? "Удалить из избранного" : "Добавить в избранное"}><Star size={17} fill={favorite ? "currentColor" : "none"} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-forest text-xs font-black text-lime">{brandInitials(station.brand)}</span>
          <div className="min-w-0 flex-1"><span className="text-[10px] font-bold uppercase tracking-[.14em] text-forest dark:text-lime">{station.brand || "АЗС"}</span><h2 className="mt-0.5 text-lg font-black leading-tight">{station.name}</h2><p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-ink/50 dark:text-white/50"><MapPin className="mt-0.5 shrink-0" size={13} />{station.address || "Адрес не указан"}</p><p className="mt-1 text-xs font-bold text-forest dark:text-lime">{formatDistance(distance)}</p></div>
          <a href={routeUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1.5 rounded-full bg-forest px-3 py-2 text-xs font-bold text-white transition hover:bg-ink dark:bg-lime dark:text-ink"><Navigation size={14} />Маршрут</a>
        </div>

        <div className={`mt-5 rounded-2xl p-4 ${overallStyle.panel}`}>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] opacity-60">Статус АЗС</p>
          <p className="mt-2 flex items-center gap-2 text-xl font-black"><i className={`h-3 w-3 rounded-full ${overallStyle.dot}`} />{overall.label}</p>
        </div>

        <div className="mt-3 rounded-2xl border border-ink/[.07] bg-white p-4 dark:border-white/[.07] dark:bg-[#19241e]">
          <div className="flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-ink/40 dark:text-white/40">Уверенность</p><p className={`${hasEnoughConfirmations ? "text-2xl" : "text-sm text-amber-700 dark:text-amber-300"} mt-1 font-black`}>{detailsLoading ? "—" : !details ? "Нет данных" : hasEnoughConfirmations ? `${details.confidence}%` : "Недостаточно подтверждений"}</p></div>{detailsLoading && <span className="h-7 w-14 animate-pulse rounded-lg bg-ink/5 dark:bg-white/5" />}</div>
          {hasEnoughConfirmations && <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/[.07] dark:bg-white/[.07]"><i className="block h-full rounded-full bg-gradient-to-r from-amber-400 via-lime to-emerald-500 transition-[width] duration-700" style={{ width: `${details?.confidence ?? 0}%` }} /></div>}
          <p className="mt-2 text-[10px] leading-relaxed text-ink/40 dark:text-white/40">{detailsLoading ? "Загружаем данные об уверенности…" : !details ? "Не удалось получить данные для расчёта." : hasEnoughConfirmations ? "Рассчитано по свежести, количеству и согласованности подтверждений." : "Числовая оценка появится после нескольких независимых подтверждений."}</p>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-cream p-3 dark:bg-white/5"><dt className="text-ink/40 dark:text-white/40">{(details?.confirmation_count ?? 0) > 0 ? "Последнее подтверждение" : "Последнее обновление"}</dt><dd className="mt-1 font-bold">{relativeTime(details?.last_confirmation_at || station.updated_at, now)}</dd></div>
          <div className="rounded-xl bg-cream p-3 dark:bg-white/5"><dt className="text-ink/40 dark:text-white/40">Источник</dt><dd className="mt-1 truncate font-bold">{details?.source || station.update_source}</dd></div>
          {(details?.confirmation_count ?? 0) > 1 && <div className="col-span-2 flex items-center justify-between rounded-xl bg-cream p-3 dark:bg-white/5"><dt className="text-ink/40 dark:text-white/40">Количество подтверждений</dt><dd className="font-black">{details?.confirmation_count}</dd></div>}
        </dl>

        <div className="mt-5"><h3 className="text-sm font-black">Топливо</h3><div className="mt-2 grid grid-cols-2 gap-2">{filterFuelKeys.map((fuel) => {
          const value = station[fuel];
          const kind: StationStatusKind = value === true ? "available" : value === false ? "unavailable" : "unknown";
          return <div key={fuel} className="flex items-center justify-between rounded-xl border border-ink/[.07] bg-white px-3 py-2.5 text-xs dark:border-white/[.07] dark:bg-[#19241e]"><b>{filterFuelLabels[fuel]}</b><span className="flex items-center gap-1.5 text-[10px] font-bold text-ink/50 dark:text-white/50"><i className={`h-2 w-2 rounded-full ${statusStyles[kind].dot}`} />{value === true ? "Есть" : value === false ? "Нет" : "Нет данных"}</span></div>;
        })}</div></div>

        <div className="mt-5 pb-2"><h3 className="text-sm font-black">Последние подтверждения</h3>{detailsLoading ? <div className="mt-2 space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-ink/5 dark:bg-white/5" />)}</div> : details?.history.length ? <div className="mt-2 overflow-hidden rounded-2xl border border-ink/[.07] bg-white dark:border-white/[.07] dark:bg-[#19241e]">{details.history.map((entry) => <div key={entry.id} className="flex items-center justify-between border-b border-ink/[.06] px-3 py-2.5 last:border-0 dark:border-white/[.06]"><span className="flex items-center gap-2 text-xs font-bold"><i className={`h-2 w-2 rounded-full ${statusStyles[entry.status].dot}`} />{entry.label}</span><span className="flex items-center gap-1 text-[10px] text-ink/40 dark:text-white/40"><Clock3 size={10} />{relativeTime(entry.confirmed_at, now)}</span></div>)}</div> : <p className="mt-2 rounded-xl bg-cream p-3 text-xs text-ink/45 dark:bg-white/5 dark:text-white/45">История пока не накоплена.</p>}</div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-ink/[.08] bg-white p-3 dark:border-white/10 dark:bg-[#19241e]">
        <a href={routeUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center gap-1 rounded-xl bg-forest px-2 py-2.5 text-[10px] font-bold text-white transition hover:bg-ink dark:bg-lime dark:text-ink"><Navigation size={16} />Маршрут</a>
        <button onClick={onReport} className="flex flex-col items-center justify-center gap-1 rounded-xl bg-cream px-2 py-2.5 text-[10px] font-bold transition hover:bg-forest/10 dark:bg-white/5"><Flag size={16} />Сообщить</button>
        <button onClick={onShare} className="flex flex-col items-center justify-center gap-1 rounded-xl bg-cream px-2 py-2.5 text-[10px] font-bold transition hover:bg-forest/10 dark:bg-white/5"><Share2 size={16} />Поделиться</button>
      </div>
    </section>
  );
}
