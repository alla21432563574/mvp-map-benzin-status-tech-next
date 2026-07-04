"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { fuelKeys, fuelLabels, type FuelKey, type Station } from "@/lib/types";

type Props = { station: Station; onClose: () => void };

export default function ReportModal({ station, onClose }: Props) {
  const [values, setValues] = useState<Record<FuelKey, boolean | null>>({
    ai92: station.ai92,
    ai95: station.ai95,
    diesel: station.diesel,
    gas: station.gas,
  });
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("loading");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station_id: station.id, ...values, reporter_name: name || null, comment: comment || null }),
      });
      if (!response.ok) throw new Error("Не удалось отправить сообщение");
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/35 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 shadow-soft sm:max-w-lg sm:rounded-[28px] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Сообщить статус</p><h2 className="mt-2 text-2xl font-bold">{station.name}</h2><p className="mt-1 text-sm text-ink/55">{station.address}</p></div>
          <button onClick={onClose} className="rounded-full bg-cream p-2 text-ink/65 hover:text-ink" aria-label="Закрыть"><X size={20} /></button>
        </div>

        {state === "done" ? (
          <div className="mt-8 rounded-2xl bg-forest/10 p-6 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-forest text-white"><Check /></span><h3 className="mt-4 text-lg font-bold">Спасибо, сообщение отправлено</h3><p className="mt-2 text-sm text-ink/60">Оно появится на карте после проверки администратором.</p><button onClick={onClose} className="mt-5 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white">Готово</button></div>
        ) : (
          <form onSubmit={submit} className="mt-6">
            <p className="text-sm font-bold">Что сейчас есть на АЗС?</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {fuelKeys.map((fuel) => (
                <button type="button" key={fuel} onClick={() => setValues((old) => ({ ...old, [fuel]: old[fuel] === true ? false : true }))} className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-bold transition ${values[fuel] ? "border-forest bg-forest text-white" : "border-ink/10 bg-cream text-ink/60"}`}>
                  {fuelLabels[fuel]} <span className={`h-2.5 w-2.5 rounded-full ${values[fuel] ? "bg-lime" : "bg-ink/20"}`} />
                </button>
              ))}
            </div>
            <label className="mt-5 block text-sm font-bold">Ваше имя <span className="font-normal text-ink/40">(необязательно)</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-2xl border border-ink/10 bg-cream px-4 py-3 outline-none focus:border-forest" placeholder="Как к вам обращаться" /></label>
            <label className="mt-4 block text-sm font-bold">Комментарий <span className="font-normal text-ink/40">(необязательно)</span><textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-ink/10 bg-cream px-4 py-3 outline-none focus:border-forest" placeholder="Например: большая очередь" /></label>
            {state === "error" && <p className="mt-3 text-sm font-bold text-red-600">Не получилось отправить. Попробуйте ещё раз.</p>}
            <button disabled={state === "loading"} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-3.5 font-bold text-white transition hover:bg-forest disabled:opacity-60">{state === "loading" && <Loader2 className="animate-spin" size={18} />} Отправить на проверку</button>
          </form>
        )}
      </div>
    </div>
  );
}
