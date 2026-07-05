import { NextResponse } from "next/server";
import { createAdminClient, createPublicClient } from "@/lib/supabase";
import { calculateStationConfidence, type RankingSignal } from "@/lib/smart-ranking";
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

function buildDetails(station: Station, reports: ReportRow[], totalReports: number): StationDetails {
  const current = snapshotStatus(station);
  const reportHistory: StationHistoryEntry[] = reports.map((report) => {
    const status = snapshotStatus({ ...report, ai98: null, ai100: null });
    return { id: report.id, ...status, confirmed_at: report.moderated_at || report.created_at, source: report.source };
  });
  const history = reportHistory
    .sort((left, right) => new Date(right.confirmed_at).getTime() - new Date(left.confirmed_at).getTime())
    .slice(0, 8);

  const confirmationCount = totalReports;
  const confirmerKeys = new Set(reports.map((report) => report.telegram_user_id ? `telegram:${report.telegram_user_id}` : report.reporter_name ? `name:${report.reporter_name.toLocaleLowerCase("ru")}` : `source:${report.source}`));
  const uniqueConfirmers = confirmerKeys.size;
  const matching = reportHistory.filter((entry) => entry.status === current.status).length;
  const signal: RankingSignal | undefined = confirmationCount ? {
    confirmationCount,
    uniqueConfirmers,
    consistency: reportHistory.length > 1 ? matching / reportHistory.length : 0.5,
    lastConfirmationAt: history[0]?.confirmed_at || null,
  } : undefined;
  const { confidence, factors } = calculateStationConfidence(station, signal, Date.now());
  const latest = history[0] || {
    confirmed_at: station.updated_at,
    source: station.update_source,
  };

  return {
    confidence,
    confirmation_count: confirmationCount,
    unique_confirmers: uniqueConfirmers,
    last_confirmation_at: latest.confirmed_at,
    source: latest.source,
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

  const { data: station, error: stationError } = await client.from("stations").select("id,name,address,latitude,longitude,brand,ai92,ai95,diesel,gas,updated_at,update_source").eq("id", id).eq("is_active", true).single();
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
