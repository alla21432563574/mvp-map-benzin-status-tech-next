"use client";

import Link from "next/link";
import { ArrowLeft, Check, Clock3, Fuel, Loader2, LockKeyhole, MapPin, X } from "lucide-react";
import { useState } from "react";
import { fuelKeys, fuelLabels, type PendingReport } from "@/lib/types";

export default function AdminPanel() {
  const [key, setKey] = useState("");
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [state, setState] = useState<"locked" | "loading" | "ready" | "error">("locked");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load(event?: React.FormEvent) {
    event?.preventDefault(); setState("loading"); setError("");
    const response = await fetch("/api/admin/reports", { headers: { "x-admin-key": key } });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Не удалось войти"); setState("error"); return; }
    setReports(data.reports ?? []); setState("ready");
  }

  async function moderate(id: string, action: "approved" | "rejected") {
    setWorking(id);
    const response = await fetch("/api/admin/reports", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": key }, body: JSON.stringify({ report_id: id, action }) });
    if (response.ok) setReports((old) => old.filter((report) => report.id !== id));
    else setError("Не удалось обработать сообщение");
    setWorking(null);
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-5 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-2 text-sm font-bold text-ink/60 hover:text-ink"><ArrowLeft size={17} />На карту</Link><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-lime"><Fuel size={18} /></span><b>Есть топливо</b></div></div>
        <header className="mt-10"><p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Модерация</p><h1 className="mt-2 text-3xl font-bold sm:text-4xl">Сообщения пользователей</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/55">Принятый статус обновит карточку АЗС. Отклонённый останется в истории и не повлияет на карту.</p></header>

        {state !== "ready" ? (
          <form onSubmit={load} className="mt-10 max-w-md rounded-[28px] bg-white p-6 shadow-soft sm:p-8"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-forest/10 text-forest"><LockKeyhole /></span><h2 className="mt-5 text-xl font-bold">Вход для модератора</h2><p className="mt-2 text-sm text-ink/50">Введите ключ из переменной ADMIN_SECRET.</p><input type="password" value={key} onChange={(e) => setKey(e.target.value)} className="mt-5 w-full rounded-2xl border border-ink/10 bg-cream px-4 py-3 outline-none focus:border-forest" placeholder="Ключ доступа" required />{error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}<button disabled={state === "loading"} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 font-bold text-white disabled:opacity-60">{state === "loading" && <Loader2 className="animate-spin" size={18} />}Открыть очередь</button></form>
        ) : (
          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">Ожидают проверки <span className="ml-2 rounded-full bg-ink px-2.5 py-1 text-xs text-white">{reports.length}</span></h2><button onClick={() => load()} className="text-xs font-bold text-forest">Обновить</button></div>
            {reports.length === 0 ? <div className="rounded-[28px] bg-white p-10 text-center shadow-soft"><Check className="mx-auto text-forest" size={30} /><h3 className="mt-4 text-lg font-bold">Очередь пуста</h3><p className="mt-1 text-sm text-ink/45">Все сообщения уже обработаны.</p></div> : <div className="grid gap-4 md:grid-cols-2">{reports.map((report) => <article key={report.id} className="rounded-[26px] bg-white p-6 shadow-soft"><div className="flex items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase tracking-wider text-forest">{report.station?.brand ?? "АЗС"} · {report.source}</span><h3 className="mt-1 text-lg font-bold">{report.station?.name ?? "Неизвестная АЗС"}</h3><p className="mt-1 flex items-center gap-1 text-xs text-ink/45"><MapPin size={12} />{report.station?.address}</p></div><span className="flex items-center gap-1 text-[11px] text-ink/40"><Clock3 size={12} />{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(report.created_at))}</span></div><div className="mt-5 grid grid-cols-4 gap-2">{fuelKeys.map((fuel) => <div key={fuel} className={`rounded-xl py-2 text-center text-[11px] font-bold ${report[fuel] ? "bg-forest/10 text-forest" : "bg-red-50 text-red-600"}`}>{fuelLabels[fuel]}<span className="mt-1 block">{report[fuel] ? "есть" : "нет"}</span></div>)}</div>{(report.reporter_name || report.comment) && <div className="mt-4 rounded-2xl bg-cream p-3 text-xs text-ink/60"><b>{report.reporter_name || "Аноним"}</b>{report.comment && <p className="mt-1 leading-relaxed">{report.comment}</p>}</div>}<div className="mt-5 grid grid-cols-2 gap-2"><button disabled={working === report.id} onClick={() => moderate(report.id, "rejected")} className="flex items-center justify-center gap-1.5 rounded-full border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600"><X size={16} />Отклонить</button><button disabled={working === report.id} onClick={() => moderate(report.id, "approved")} className="flex items-center justify-center gap-1.5 rounded-full bg-forest px-4 py-2.5 text-sm font-bold text-white">{working === report.id ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}Принять</button></div></article>)}</div>}
          </section>
        )}
      </div>
    </main>
  );
}
