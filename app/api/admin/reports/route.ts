import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

function authorized(request: NextRequest) {
  const expected = process.env.ADMIN_SECRET;
  return Boolean(expected && request.headers.get("x-admin-key") === expected);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Неверный ключ" }, { status: 401 });
  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { data, error } = await supabase.from("pending_reports").select("*, station:stations(name,address,brand)").eq("status", "pending").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Неверный ключ" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.report_id !== "string" || !["approved", "rejected"].includes(body.action)) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { error } = await supabase.rpc("moderate_report", { p_report_id: body.report_id, p_action: body.action, p_moderator_note: body.note ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
