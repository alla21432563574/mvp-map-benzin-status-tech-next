"use client";

import { AlertTriangle, Check, CheckCircle2, Clock3, Flag, Fuel, Gauge, Loader2, MapPin, Navigation, Share2, ShieldCheck, Star, UsersRound, X, XCircle } from "lucide-react";
import { useState, type ComponentType } from "react";
import { brandInitials, formatDistance, relativeTime, stationDisplayStatus, type StationStatusKind } from "@/lib/map-utils";
import { filterFuelKeys, filterFuelLabels, type Station, type StationDetails } from "@/lib/types";

const statusStyles: Record<StationStatusKind, { panel: string; dot: string }> = {
  available: { panel: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200", dot: "bg-emerald-500" },
  partial: { panel: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200", dot: "bg-amber-500" },
  unavailable: { panel: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200", dot: "bg-red-500" },
  unknown: { panel: "bg-ink/5 text-ink/55 dark:bg-white/5 dark:text-white/55", dot: "bg-gray-400" },
};

const badgeTone = (label: string) => {
  const value = label.toLocaleLowerCase("ru").replace(/ё/g, "е");
  if (value.includes("очеред")) return "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200";
  if (value.includes("отдельные") || value.includes("мало") || value.includes("лимит")) return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200";
  if (value.includes("исправ")) return "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200";
  if (value.includes("на месте") || value.includes("надеж") || value.includes("надёж")) return "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200";
  if (value.includes("нет топлива")) return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200";
  if (value.includes("есть топливо")) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200";
  return "bg-ink/[.06] text-ink/55 dark:bg-white/[.08] dark:text-white/55";
};

type Props = {
  station: Station;
  details: StationDetails | null;
  detailsLoading: boolean;
  distance: number;
  favorite: boolean;
  now: number;
  onClose: () => void;
  onReport: () => void;
  onFavorite: () => void;
  onShare: () => void;
};

type SituationKind = "available" | "queue" | "partial" | "unavailable";
type QuickReportState = "idle" | "loading" | "done" | "error";

const situationOptions: Array<{
  kind: SituationKind;
  title: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  classes: string;
  iconClasses: string;
}> = [
  {
    kind: "available",
    title: "Есть топливо",
    description: "Заправка работает в обычном режиме",
    icon: Fuel,
    classes: "hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
    iconClasses: "bg-emerald-100 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  {
    kind: "queue",
    title: "Очередь",
    description: "Большая очередь на заправке",
    icon: UsersRound,
    classes: "hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-500/10",
    iconClasses: "bg-orange-100 text-orange-500 dark:bg-orange-500/15 dark:text-orange-300",
  },
  {
    kind: "partial",
    title: "Мало топлива",
    description: "Топливо есть, но в ограниченном количестве",
    icon: Gauge,
    classes: "hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10",
    iconClasses: "bg-amber-100 text-amber-500 dark:bg-amber-500/15 dark:text-amber-300",
  },
  {
    kind: "unavailable",
    title: "Нет топлива",
    description: "Топлива нет",
    icon: Fuel,
    classes: "hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-500/10",
    iconClasses: "bg-red-100 text-red-500 dark:bg-red-500/15 dark:text-red-300",
  },
];

export default function StationCard({ station, details, detailsLoading, distance, favorite, now, onClose, onReport, onFavorite, onShare }: Props) {
  const [quickReportState, setQuickReportState] = useState<QuickReportState>("idle");
  const [quickReportKind, setQuickReportKind] = useState<SituationKind | null>(null);
  const routeUrl = `https://yandex.ru/maps/?rtext=~${station.latitude},${station.longitude}&rtt=auto`;
  const overall = stationDisplayStatus(station);
  const overallStyle = statusStyles[overall.kind];
  const hasEnoughConfirmations = details?.confidence_status === "calculated";
  const summary = details?.last_hour_summary;
  const summaryTotal = summary ? summary.available + summary.unavailable + summary.partial + summary.on_site : 0;
  const reports24h = details?.last_24h_report_count ?? 0;
  const fuelName = (fuel: string) => ({ ai92: "АИ-92", ai95: "АИ-95", ai98: "АИ-98", ai100: "АИ-100", dt: "ДТ", gas: "Газ" }[fuel] || fuel.toUpperCase());
  const historyLabels = (entry: StationDetails["history"][number]) => {
    const values = new Set<string>();
    for (const label of entry.labels || []) if (label && label !== entry.label) values.add(label);
    for (const fuel of entry.fuel_types || []) values.add(fuelName(fuel));
    if (entry.queue_text) values.add(entry.queue_text);
    if (typeof entry.queue === "number") values.add(`очередь: ${entry.queue}`);
    if (entry.partial_reason) values.add(entry.partial_reason);
    if (entry.is_corrected) values.add("исправлено");
    if (entry.is_on_site) values.add("На месте");
    if (entry.is_reliable) values.add("Надёжный");
    return [...values];
  };

  async function submitQuickReport(kind: SituationKind) {
    if (quickReportState === "loading") return;
    setQuickReportKind(kind);
    setQuickReportState("loading");
    const baseValues = {
      ai92: typeof station.ai92 === "boolean" ? station.ai92 : null,
      ai95: typeof station.ai95 === "boolean" ? station.ai95 : null,
      diesel: typeof station.diesel === "boolean" ? station.diesel : null,
      gas: typeof station.gas === "boolean" ? station.gas : null,
    };
    const payloadByKind: Record<SituationKind, typeof baseValues & { comment: string }> = {
      available: { ai92: true, ai95: true, diesel: true, gas: true, comment: "Быстрая отметка: есть топливо" },
      queue: { ...baseValues, comment: "Быстрая отметка: очередь на АЗС" },
      partial: { ai92: null, ai95: null, diesel: null, gas: null, comment: "Быстрая отметка: мало топлива" },
      unavailable: { ai92: false, ai95: false, diesel: false, gas: false, comment: "Быстрая отметка: нет топлива" },
    };

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station_id: station.id, reporter_name: null, ...payloadByKind[kind] }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить отметку");
      setQuickReportState("done");
      window.setTimeout(() => setQuickReportState("idle"), 4500);
    } catch {
      setQuickReportState("error");
    }
  }

  return (
    <section className="station-detail flex h-full min-h-0 flex-col bg-[#fbfcf9] dark:bg-[#121b16]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink/[.08] bg-white px-4 dark:border-white/10 dark:bg-[#19241e]">
        <button onClick={onClose} className="flex items-center gap-2 rounded-full px-2 py-2 text-sm font-bold text-forest transition hover:bg-forest/10 dark:text-lime dark:hover:bg-white/10"><X size={18} />Закрыть</button>
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

        <div className="mt-3 rounded-[24px] border border-ink/[.08] bg-white p-4 shadow-sm dark:border-white/[.08] dark:bg-[#19241e]">
          <div>
            <h3 className="text-xl font-black tracking-tight">Что сейчас на АЗС?</h3>
            <p className="mt-1 text-sm font-medium text-ink/50 dark:text-white/50">Выберите актуальную ситуацию</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {situationOptions.map((option) => {
              const Icon = option.icon;
              const isLoading = quickReportState === "loading" && quickReportKind === option.kind;
              return (
                <button
                  key={option.kind}
                  type="button"
                  disabled={quickReportState === "loading"}
                  onClick={() => submitQuickReport(option.kind)}
                  className={`min-h-[132px] rounded-[22px] border border-ink/[.08] bg-white p-3 text-left transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70 dark:border-white/[.08] dark:bg-white/[.03] ${option.classes}`}
                >
                  <span className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${option.iconClasses}`}>
                    {isLoading ? <Loader2 className="animate-spin" size={24} /> : <Icon size={24} />}
                  </span>
                  <span className="mt-4 block text-center text-sm font-black leading-tight text-ink dark:text-white">{option.title}</span>
                  <span className="mt-2 block text-center text-[11px] font-semibold leading-snug text-ink/50 dark:text-white/45">{option.description}</span>
                </button>
              );
            })}
          </div>

          {quickReportState === "done" && (
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
              <Check size={15} />Спасибо, отметка сохранена
            </div>
          )}
          {quickReportState === "error" && (
            <div className="mt-3 rounded-2xl bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-200">
              Не получилось сохранить отметку. Попробуйте ещё раз.
            </div>
          )}

          <a href={routeUrl} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 rounded-[22px] border border-ink/[.08] bg-white p-3 transition hover:border-forest/25 hover:bg-forest/5 dark:border-white/[.08] dark:bg-white/[.03]">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"><Navigation size={22} /></span>
            <span className="min-w-0 flex-1"><span className="block text-base font-black">Маршрут до АЗС</span><span className="mt-0.5 block text-xs font-medium text-ink/45 dark:text-white/45">Откроется в выбранном приложении</span></span>
            <span className="text-xl font-black text-ink/25 dark:text-white/25">›</span>
          </a>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-ink/[.08] bg-[#fbfcf9] p-3 dark:border-white/[.08] dark:bg-white/[.03]">
              <ShieldCheck className="text-forest dark:text-lime" size={22} />
              <p className="mt-2 text-xs text-ink/50 dark:text-white/45">Данные</p>
              <p className="text-sm font-black leading-tight">подтверждённые отметки водителей</p>
            </div>
            <div className="rounded-2xl border border-ink/[.08] bg-[#fbfcf9] p-3 dark:border-white/[.08] dark:bg-white/[.03]">
              <UsersRound className="text-ink/70 dark:text-white/70" size={22} />
              <p className="mt-2 text-xs text-ink/50 dark:text-white/45">Отметок водителей</p>
              <p className="text-2xl font-black">{detailsLoading ? "—" : reports24h}</p>
              <p className="text-xs text-ink/45 dark:text-white/40">за последние 24 часа</p>
            </div>
            <div className="rounded-2xl border border-ink/[.08] bg-[#fbfcf9] p-3 sm:col-span-2 dark:border-white/[.08] dark:bg-white/[.03]">
              <p className="flex items-center gap-2 text-sm font-bold text-ink/55 dark:text-white/55"><Clock3 size={15} />Обновлено {relativeTime(details?.last_confirmation_at || station.updated_at, now)}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-ink/[.07] bg-white p-4 dark:border-white/[.07] dark:bg-[#19241e]">
          <div className="flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-ink/40 dark:text-white/40">Уверенность</p><p className={`${hasEnoughConfirmations ? "text-2xl" : "text-sm text-amber-700 dark:text-amber-300"} mt-1 font-black`}>{detailsLoading ? "—" : !details ? "Нет данных" : hasEnoughConfirmations ? `${details.confidence}%` : "Недостаточно подтверждений"}</p></div>{detailsLoading && <span className="h-7 w-14 animate-pulse rounded-lg bg-ink/5 dark:bg-white/5" />}</div>
          {hasEnoughConfirmations && <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/[.07] dark:bg-white/[.07]"><i className="block h-full rounded-full bg-gradient-to-r from-amber-400 via-lime to-emerald-500 transition-[width] duration-700" style={{ width: `${details?.confidence ?? 0}%` }} /></div>}
          <p className="mt-2 text-[10px] leading-relaxed text-ink/40 dark:text-white/40">{detailsLoading ? "Загружаем данные об уверенности…" : !details ? "Не удалось получить данные для расчёта." : hasEnoughConfirmations ? "Совпадение преобладающего статуса среди последних 10 реальных отметок." : "Числовая оценка появится после нескольких реальных отметок."}</p>
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

        <div className="mt-5 pb-2">
          <h3 className="text-sm font-black">Последние отметки</h3>
          {summaryTotal > 0 && <div className="mt-2 rounded-2xl bg-cream p-3 dark:bg-white/5"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-ink/40 dark:text-white/40">За последний час</p><div className="mt-2 flex flex-wrap gap-1.5">
            {summary!.available > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800"><CheckCircle2 size={11} />{summary!.available} «Есть»</span>}
            {summary!.unavailable > 0 && <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-700"><XCircle size={11} />{summary!.unavailable} «Нет»</span>}
            {summary!.partial > 0 && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800"><AlertTriangle size={11} />{summary!.partial} «Частично»</span>}
            {summary!.on_site > 0 && <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-800"><MapPin size={11} />{summary!.on_site} «На месте»</span>}
          </div></div>}
          {detailsLoading ? <div className="mt-2 space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-ink/5 dark:bg-white/5" />)}</div> : details?.history.length ? <div className="mt-2 overflow-hidden rounded-2xl border border-ink/[.07] bg-white dark:border-white/[.07] dark:bg-[#19241e]">{details.history.map((entry) => {
            const badges = historyLabels(entry);
            return <div key={entry.id} className="border-b border-ink/[.06] px-3 py-3 last:border-0 dark:border-white/[.06]"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-bold"><i className={`h-2.5 w-2.5 rounded-full ${statusStyles[entry.status].dot}`} />{entry.label}</span><span className="flex shrink-0 items-center gap-1 text-[10px] text-ink/40 dark:text-white/40"><Clock3 size={10} />{relativeTime(entry.confirmed_at, now)}</span></div>{badges.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{badges.map((label) => <span key={label} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeTone(label)}`}>{label}</span>)}</div>}{entry.comment && <p className="mt-1.5 text-xs leading-relaxed text-ink/60 dark:text-white/60">{entry.comment}</p>}</div>;
          })}</div> : <p className="mt-2 rounded-xl bg-cream p-3 text-xs text-ink/45 dark:bg-white/5 dark:text-white/45">Свежих отметок пока нет.</p>}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-ink/[.08] bg-white p-3 dark:border-white/10 dark:bg-[#19241e]">
        <a href={routeUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center gap-1 rounded-xl bg-forest px-2 py-2.5 text-[10px] font-bold text-white transition hover:bg-ink dark:bg-lime dark:text-ink"><Navigation size={16} />Маршрут</a>
        <button onClick={onReport} className="flex flex-col items-center justify-center gap-1 rounded-xl bg-cream px-2 py-2.5 text-[10px] font-bold transition hover:bg-forest/10 dark:bg-white/5"><Flag size={16} />Сообщить</button>
        <button onClick={onShare} className="flex flex-col items-center justify-center gap-1 rounded-xl bg-cream px-2 py-2.5 text-[10px] font-bold transition hover:bg-forest/10 dark:bg-white/5"><Share2 size={16} />Поделиться</button>
      </div>
    </section>
  );
}
