import { NextResponse } from "next/server";
import { createAdminClient, createPublicClient } from "@/lib/supabase";
import type { StationHistoryEntry, StationReportSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type ReportRow = {
  id: string;
  status: StationHistoryEntry["status"];
  fuel_type: string | null;
  fuel_types: string[] | null;
  queue: number | null;
  queue_text: string | null;
  comment: string | null;
  is_on_site: boolean | null;
  source: string;
  is_counted: boolean | null;
  created_at: string;
};

const labels: Record<StationHistoryEntry["status"], string> = {
  available: "Есть топливо",
  partial: "Частично",
  unavailable: "Нет топлива",
  unknown: "Нет данных",
};

function calculateConfidence(reports: ReportRow[]) {
  const recent = reports.filter((report) => report.status !== "unknown").slice(0, 10);
  if (recent.length < 2) return { confidence: 0, status: "insufficient" as const, sampleSize: recent.length };
  const counts = recent.reduce<Record<string, number>>((result, report) => {
    result[report.status] = (result[report.status] || 0) + 1;
    return result;
  }, {});
  const agreement = Math.max(...Object.values(counts));
  return { confidence: Math.round(agreement / recent.length * 100), status: "calculated" as const, sampleSize: recent.length };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Некорректный идентификатор АЗС" }, { status: 400 });
  }

  const client = createAdminClient() || createPublicClient();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
  const [latestResult, recentResult] = await Promise.all([
    client.from("station_reports")
      .select("id,status,fuel_type,fuel_types,queue,queue_text,comment,is_on_site,source,is_counted,created_at")
      .eq("station_id", id).order("created_at", { ascending: false }).limit(20),
    client.from("station_reports")
      .select("status,is_on_site").eq("station_id", id).gte("created_at", oneHourAgo).limit(1_000),
  ]);
  if (latestResult.error) return NextResponse.json({ error: latestResult.error.message }, { status: 500 });
  if (recentResult.error) return NextResponse.json({ error: recentResult.error.message }, { status: 500 });

  const rows = (latestResult.data || []) as ReportRow[];
  const summary = (recentResult.data || []).reduce<StationReportSummary>((result, report) => {
    if (report.status === "available") result.available += 1;
    if (report.status === "unavailable") result.unavailable += 1;
    if (report.status === "partial") result.partial += 1;
    if (report.is_on_site === true) result.on_site += 1;
    return result;
  }, { available: 0, unavailable: 0, partial: 0, on_site: 0 });
  const confidence = calculateConfidence(rows);
  const reports: StationHistoryEntry[] = rows.map((report) => ({
    id: report.id,
    status: report.status,
    label: labels[report.status],
    confirmed_at: report.created_at,
    source: report.source,
    fuel_type: report.fuel_type,
    fuel_types: report.fuel_types || [],
    queue: report.queue,
    queue_text: report.queue_text,
    comment: report.comment,
    is_on_site: report.is_on_site,
  }));

  return NextResponse.json({ reports, summary, ...confidence }, {
    headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" },
  });
}
