import { NextResponse } from "next/server";
import { createAdminClient, createPublicClient } from "@/lib/supabase";
import type { Station, StationDetails, StationHistoryEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

type ReportRow = {
  id: string;
  ai92: boolean | null;
  ai95: boolean | null;
  diesel: boolean | null;
  gas: boolean | null;
  source: string;
  reporter_name: string | null;
  telegram_user_id: number | null;
  created_at: string;
  moderated_at: string | null;
};

type FuelSnapshot = Pick<Station, "ai92" | "ai95" | "ai98" | "ai100" | "diesel" | "gas">;

function snapshotStatus(snapshot: FuelSnapshot): Pick<StationHistoryEntry, "status" | "label"> {
  const values = [snapshot.ai92, snapshot.ai95, snapshot.ai98, snapshot.ai100, snapshot.diesel, snapshot.gas];
  const known = values.filter((value): value is boolean => typeof value === "boolean");
  if (!known.length) return { status: "unknown", label: "Нет данных" };
  const available = known.filter(Boolean).length;
  if (!available) return { status: "unavailable", label: "Нет топлива" };
  if (available === known.length) return { status: "available", label: "Есть топливо" };
  return { status: "partial", label: "Частично" };
}

function freshnessScore(value: string) {
  const ageHours = Math.max(0, (Date.now() - new Date(value).getTime()) / 3_600_000);
  if (ageHours <= 0.25) return 1;
  if (ageHours <= 1) return 0.94;
  if (ageHours <= 6) return 0.85;
  if (ageHours <= 24) return 0.7;
  if (ageHours <= 72) return 0.45;
  return 0.2;
}

function buildDetails(station: Station, reports: ReportRow[], totalReports: number): StationDetails {
  const current = snapshotStatus(station);
  const reportHistory: StationHistoryEntry[] = reports.map((report) => {
    const status = snapshotStatus({ ...report, ai98: null, ai100: null });
    return { id: report.id, ...status, confirmed_at: report.moderated_at || report.created_at, source: report.source };
  });
  const history: StationHistoryEntry[] = [
    { id: `current-${station.id}`, ...current, confirmed_at: station.updated_at, source: station.update_source },
    ...reportHistory,
  ].sort((left, right) => new Date(right.confirmed_at).getTime() - new Date(left.confirmed_at).getTime()).slice(0, 8);

  const confirmationCount = Math.max(1, totalReports + 1);
  const confirmerKeys = new Set(reports.map((report) => report.telegram_user_id ? `telegram:${report.telegram_user_id}` : report.reporter_name ? `name:${report.reporter_name.toLocaleLowerCase("ru")}` : `source:${report.source}`));
  const uniqueConfirmers = Math.max(1, confirmerKeys.size);
  const comparable = reportHistory.length ? reportHistory : history;
  const matching = comparable.filter((entry) => entry.status === current.status).length;
  const factors = {
    freshness: freshnessScore(station.updated_at),
    confirmations: Math.min(1, Math.log2(confirmationCount + 1) / Math.log2(16)),
    consistency: comparable.length > 1 ? matching / comparable.length : 0.55,
    confirmers: Math.min(1, uniqueConfirmers / 5),
    coverage: [station.ai92, station.ai95, station.ai98, station.ai100, station.diesel, station.gas].filter((value) => typeof value === "boolean").length / 6,
  };
  const confidence = Math.round(100 * (factors.freshness * 0.45 + factors.confirmations * 0.2 + factors.consistency * 0.2 + factors.confirmers * 0.1 + factors.coverage * 0.05));

  return {
    confidence: Math.max(1, Math.min(100, confidence)),
    confirmation_count: confirmationCount,
    unique_confirmers: uniqueConfirmers,
    last_confirmation_at: history[0]?.confirmed_at || station.updated_at,
    source: history[0]?.source || station.update_source,
    history,
    factors,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Некорректный идентификатор АЗС" }, { status: 400 });
  }

  const admin = createAdminClient();
  const client = admin || createPublicClient();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: station, error: stationError } = await client.from("stations").select("id,name,address,latitude,longitude,brand,ai92,ai95,diesel,gas,updated_at,update_source").eq("id", id).single();
  if (stationError || !station) return NextResponse.json({ error: "АЗС не найдена" }, { status: 404 });

  let reports: ReportRow[] = [];
  let totalReports = 0;
  if (admin) {
    const { data, error, count } = await admin
      .from("pending_reports")
      .select("id,ai92,ai95,diesel,gas,source,reporter_name,telegram_user_id,created_at,moderated_at", { count: "exact" })
      .eq("station_id", id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(12);
    if (!error) {
      reports = (data || []) as ReportRow[];
      totalReports = count || reports.length;
    }
  }

  return NextResponse.json({ details: buildDetails(station as Station, reports, totalReports) }, { headers: { "Cache-Control": "private, max-age=30" } });
}
