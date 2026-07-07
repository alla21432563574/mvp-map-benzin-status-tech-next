import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createPublicClient } from "@/lib/supabase";
import { fuelKeys, type StationStatus } from "@/lib/types";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const MAX_REPORTS_PER_WINDOW = 8;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1_000;
const stationStatuses = new Set<StationStatus>(["available", "partial", "unavailable", "unknown"]);
const requestBuckets = new Map<string, number[]>();
const recentReports = new Map<string, number>();

function cleanup(now: number) {
  for (const [key, timestamps] of requestBuckets) {
    const fresh = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (fresh.length) requestBuckets.set(key, fresh);
    else requestBuckets.delete(key);
  }
  for (const [key, timestamp] of recentReports) {
    if (now - timestamp >= DUPLICATE_WINDOW_MS) recentReports.delete(key);
  }
}

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function reportFingerprint(body: Record<string, unknown>) {
  return [
    body.station_id,
    body.station_status ?? "",
    body.has_queue ?? "",
    ...fuelKeys.map((key) => String(body[key])),
    typeof body.comment === "string" ? body.comment.trim().toLocaleLowerCase("ru").slice(0, 120) : "",
  ].join("|");
}

function rateLimit(request: NextRequest, body: Record<string, unknown>) {
  const now = Date.now();
  cleanup(now);
  const key = clientKey(request);
  const timestamps = requestBuckets.get(key) ?? [];
  if (timestamps.length >= MAX_REPORTS_PER_WINDOW) return NextResponse.json({ error: "Слишком много сообщений. Попробуйте позже." }, { status: 429 });

  const fingerprint = `${key}:${reportFingerprint(body)}`;
  const previous = recentReports.get(fingerprint);
  if (previous && now - previous < DUPLICATE_WINDOW_MS) return NextResponse.json({ error: "Такое сообщение уже получено." }, { status: 409 });

  timestamps.push(now);
  requestBuckets.set(key, timestamps);
  recentReports.set(fingerprint, now);
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.station_id !== "string") return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  if (!fuelKeys.every((key) => typeof body[key] === "boolean" || body[key] === null)) return NextResponse.json({ error: "Некорректный статус топлива" }, { status: 400 });
  if (body.station_status !== undefined && body.station_status !== null && (typeof body.station_status !== "string" || !stationStatuses.has(body.station_status as StationStatus))) {
    return NextResponse.json({ error: "Некорректный статус АЗС" }, { status: 400 });
  }
  if (body.has_queue !== undefined && body.has_queue !== null && typeof body.has_queue !== "boolean") {
    return NextResponse.json({ error: "Некорректный статус очереди" }, { status: 400 });
  }

  const limited = rateLimit(request, body as Record<string, unknown>);
  if (limited) return limited;

  const supabase = createAdminClient();
  if (!supabase) {
    if (!createPublicClient()) return NextResponse.json({ ok: true, demo: true }, { status: 201 });
    return NextResponse.json({ error: "Серверная отправка сообщений не настроена" }, { status: 503 });
  }

  const { error } = await supabase.from("pending_reports").insert({
    station_id: body.station_id,
    ai92: body.ai92,
    ai95: body.ai95,
    diesel: body.diesel,
    gas: body.gas,
    station_status: body.station_status ?? null,
    has_queue: body.has_queue ?? null,
    reporter_name: typeof body.reporter_name === "string" ? body.reporter_name.slice(0, 80) : null,
    comment: typeof body.comment === "string" ? body.comment.slice(0, 500) : null,
    source: "Пользователь",
  });
  if (error) return NextResponse.json({ error: "Не удалось сохранить сообщение" }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
