import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { fuelKeys } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.station_id !== "string") return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  if (!fuelKeys.every((key) => typeof body[key] === "boolean" || body[key] === null)) return NextResponse.json({ error: "Некорректный статус топлива" }, { status: 400 });

  const supabase = createPublicClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true }, { status: 201 });

  const { error } = await supabase.from("pending_reports").insert({
    station_id: body.station_id,
    ai92: body.ai92,
    ai95: body.ai95,
    diesel: body.diesel,
    gas: body.gas,
    reporter_name: typeof body.reporter_name === "string" ? body.reporter_name.slice(0, 80) : null,
    comment: typeof body.comment === "string" ? body.comment.slice(0, 500) : null,
    source: "Пользователь",
  });
  if (error) return NextResponse.json({ error: "Не удалось сохранить сообщение" }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
