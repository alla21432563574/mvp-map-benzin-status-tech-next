import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import type { RankingSignal } from "@/lib/smart-ranking";

export const dynamic = "force-dynamic";

type ReportRow = {
  station_id: string;
  ai92: boolean | null;
  ai95: boolean | null;
  diesel: boolean | null;
  gas: boolean | null;
  reporter_name: string | null;
  telegram_user_id: number | null;
  source: string;
  created_at: string;
  moderated_at: string | null;
};

function reportStatus(report: ReportRow) {
  const known = [report.ai92, report.ai95, report.diesel, report.gas].filter((value): value is boolean => typeof value === "boolean");
  if (!known.length) return "unknown";
  const available = known.filter(Boolean).length;
  return !available ? "unavailable" : available === known.length ? "available" : "partial";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 250) : [];
  if (!ids.length) return NextResponse.json({ signals: {} });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ signals: {} });
  const { data, error } = await admin
    .from("pending_reports")
    .select("station_id,ai92,ai95,diesel,gas,reporter_name,telegram_user_id,source,created_at,moderated_at")
    .in("station_id", ids)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(5_000);
  if (error) return NextResponse.json({ signals: {} });

  const grouped = new Map<string, ReportRow[]>();
  for (const report of (data || []) as ReportRow[]) grouped.set(report.station_id, [...(grouped.get(report.station_id) || []), report]);
  const signals: Record<string, RankingSignal> = {};
  for (const [stationId, reports] of grouped) {
    const statuses = reports.map(reportStatus);
    const frequencies = new Map<string, number>();
    for (const status of statuses) frequencies.set(status, (frequencies.get(status) || 0) + 1);
    const dominantCount = Math.max(...frequencies.values());
    const confirmers = new Set(reports.map((report) => report.telegram_user_id ? `telegram:${report.telegram_user_id}` : report.reporter_name ? `name:${report.reporter_name.toLocaleLowerCase("ru")}` : `source:${report.source}`));
    signals[stationId] = {
      confirmationCount: reports.length + 1,
      uniqueConfirmers: Math.max(1, confirmers.size),
      consistency: reports.length > 1 ? dominantCount / reports.length : 0.55,
      lastConfirmationAt: reports[0]?.moderated_at || reports[0]?.created_at || null,
    };
  }
  return NextResponse.json({ signals });
}
