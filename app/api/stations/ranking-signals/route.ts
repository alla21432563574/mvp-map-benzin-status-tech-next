import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import type { RankingSignal } from "@/lib/smart-ranking";

export const dynamic = "force-dynamic";

type ReportRow = {
  station_id: string;
  status: "available" | "partial" | "unavailable" | "unknown";
  created_at: string;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 250) : [];
  if (!ids.length) return NextResponse.json({ signals: {} });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ signals: {} });
  const { data, error } = await admin
    .from("station_reports")
    .select("station_id,status,created_at")
    .in("station_id", ids)
    .order("created_at", { ascending: false })
    .limit(5_000);
  if (error) return NextResponse.json({ signals: {} });

  const grouped = new Map<string, ReportRow[]>();
  for (const report of (data || []) as ReportRow[]) {
    const existing = grouped.get(report.station_id) || [];
    if (existing.length < 10) grouped.set(report.station_id, [...existing, report]);
  }
  const signals: Record<string, RankingSignal> = {};
  for (const [stationId, reports] of grouped) {
    const statuses = reports.map((report) => report.status).filter((status) => status !== "unknown");
    if (!statuses.length) continue;
    const frequencies = new Map<string, number>();
    for (const status of statuses) frequencies.set(status, (frequencies.get(status) || 0) + 1);
    const dominantCount = Math.max(...frequencies.values());
    signals[stationId] = {
      confirmationCount: statuses.length,
      uniqueConfirmers: 0,
      consistency: dominantCount / statuses.length,
      lastConfirmationAt: reports[0]?.created_at || null,
    };
  }
  return NextResponse.json({ signals });
}
