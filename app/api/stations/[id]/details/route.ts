import { NextResponse } from "next/server";
import { createAdminClient, createPublicClient } from "@/lib/supabase";
import type { StationHistoryEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const labels: Record<StationHistoryEntry["status"], string> = {
  available: "Есть топливо",
  partial: "Частично",
  unavailable: "Нет топлива",
  unknown: "Нет данных",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Некорректный идентификатор АЗС" }, { status: 400 });
  }
  const client = createAdminClient() || createPublicClient();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data, error } = await client.from("station_reports")
    .select("id,status,fuel_type,fuel_types,queue,queue_text,labels,raw_text,queue_status,partial_reason,is_corrected,comment,is_on_site,is_reliable,source,created_at")
    .eq("station_id", id).order("created_at", { ascending: false }).limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data || [];
  const known = rows.filter((report) => report.status !== "unknown");
  const counts = known.reduce<Record<string, number>>((result, report) => {
    result[report.status] = (result[report.status] || 0) + 1;
    return result;
  }, {});
  const confidence = known.length > 1 ? Math.round(Math.max(...Object.values(counts)) / known.length * 100) : 0;
  const history: StationHistoryEntry[] = rows.map((report) => ({
    id: report.id, status: report.status as StationHistoryEntry["status"],
    label: labels[report.status as StationHistoryEntry["status"]], confirmed_at: report.created_at,
    source: report.source, fuel_type: report.fuel_type, fuel_types: report.fuel_types || [],
    queue: report.queue, queue_text: report.queue_text,
    labels: Array.isArray(report.labels) ? report.labels : [],
    raw_text: report.raw_text, queue_status: report.queue_status, partial_reason: report.partial_reason,
    is_corrected: report.is_corrected, comment: report.comment, is_on_site: report.is_on_site, is_reliable: report.is_reliable,
  }));
  return NextResponse.json({ details: {
    confidence,
    confidence_status: known.length > 1 ? "calculated" : "insufficient",
    confirmation_count: rows.length,
    unique_confirmers: 0,
    last_confirmation_at: rows[0]?.created_at || null,
    source: rows[0]?.source || "benzin-status",
    history,
    factors: { freshness: 0, confirmations: 0, consistency: confidence / 100, confirmers: 0, coverage: 0 },
  } }, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } });
}
