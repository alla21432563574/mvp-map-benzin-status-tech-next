"use client";

import { Clock3, Flag, MapPin, X } from "lucide-react";
import { fuelKeys, fuelLabels, type Station } from "@/lib/types";

export default function StationCard({ station, onClose, onReport }: { station: Station; onClose: () => void; onReport: () => void }) {
  const formatted = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(station.updated_at));
  return (
    <aside className="absolute bottom-3 left-3 right-3 z-[500] rounded-[24px] bg-white p-5 shadow-soft sm:bottom-5 sm:left-auto sm:right-5 sm:w-[390px] sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div><span className="rounded-full bg-cream px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-forest">{station.brand}</span><h2 className="mt-3 text-xl font-bold">{station.name}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-ink/55"><MapPin size={14} />{station.address}</p></div>
        <button onClick={onClose} className="rounded-full bg-cream p-2 text-ink/60" aria-label="Закрыть карточку"><X size={18} /></button>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {fuelKeys.map((fuel) => <div key={fuel} className={`rounded-xl px-2 py-3 text-center ${station[fuel] ? "bg-forest/10 text-forest" : station[fuel] === false ? "bg-red-50 text-red-600" : "bg-cream text-ink/40"}`}><div className={`mx-auto mb-2 h-2 w-2 rounded-full ${station[fuel] ? "bg-forest" : station[fuel] === false ? "bg-red-500" : "bg-ink/20"}`} /><span className="text-xs font-bold">{fuelLabels[fuel]}</span></div>)}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 text-xs text-ink/45"><span className="flex items-center gap-1.5"><Clock3 size={13} />{formatted}</span><span>{station.update_source}</span></div>
      <button onClick={onReport} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-forest"><Flag size={16} />Сообщить статус</button>
    </aside>
  );
}
