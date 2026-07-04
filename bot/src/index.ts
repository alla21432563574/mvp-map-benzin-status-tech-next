import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { Context, Markup, Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!token || !supabaseUrl || !supabaseKey) {
  throw new Error("Заполните TELEGRAM_BOT_TOKEN, SUPABASE_URL и SUPABASE_ANON_KEY");
}

const bot = new Telegraf(token);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type FuelKey = "ai92" | "ai95" | "diesel" | "gas";
type Station = {
  id: string;
  city: string;
  name: string;
  address: string;
  brand: string;
  latitude: number;
  longitude: number;
};
type Session = {
  city?: string;
  station?: Station;
  fuels: Set<FuelKey>;
};

const sessions = new Map<number, Session>();
const fuelKeys: FuelKey[] = ["ai92", "ai95", "diesel", "gas"];
const fuelLabels: Record<FuelKey, string> = {
  ai92: "АИ-92",
  ai95: "АИ-95",
  diesel: "Дизель",
  gas: "Газ",
};

function session(chatId: number) {
  let value = sessions.get(chatId);
  if (!value) {
    value = { fuels: new Set() };
    sessions.set(chatId, value);
  }
  return value;
}

async function getCities() {
  const { data, error } = await supabase.from("stations").select("city").order("city");
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.city).filter(Boolean))];
}

async function getStations(city: string) {
  const { data, error } = await supabase
    .from("stations")
    .select("id,city,name,address,brand,latitude,longitude")
    .eq("city", city)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Station[];
}

function cityKeyboard(cities: string[]) {
  return Markup.inlineKeyboard(
    cities.map((city) => Markup.button.callback(city, `city:${city}`)),
    { columns: 2 },
  );
}

function stationKeyboard(stations: Station[], distances?: Map<string, number>) {
  return Markup.inlineKeyboard(
    stations.slice(0, 12).map((station) => {
      const distance = distances?.get(station.id);
      const suffix = distance === undefined ? "" : ` · ${distance < 1 ? `${Math.round(distance * 1000)} м` : `${distance.toFixed(1)} км`}`;
      return Markup.button.callback(`${station.brand} — ${station.name}${suffix}`, `station:${station.id}`);
    }),
    { columns: 1 },
  );
}

function fuelKeyboard(selected: Set<FuelKey>) {
  return Markup.inlineKeyboard([
    ...fuelKeys.map((fuel) => [Markup.button.callback(`${selected.has(fuel) ? "✅" : "⬜️"} ${fuelLabels[fuel]}`, `fuel:${fuel}`)]),
    [Markup.button.callback("Отправить отчёт", "report:send")],
    [Markup.button.callback("Выбрать другую АЗС", "station:change")],
  ]);
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function chooseCity(ctx: Context) {
  const cities = await getCities();
  if (!cities.length) return ctx.reply("В базе пока нет городов с АЗС.");
  await ctx.reply("Выберите город:", cityKeyboard(cities));
}

bot.start(async (ctx) => {
  sessions.set(ctx.chat.id, { fuels: new Set() });
  await ctx.reply("Привет! Я собираю актуальные статусы топлива на АЗС. Отчёты появятся на карте после проверки модератором.");
  await chooseCity(ctx);
});

bot.command("report", async (ctx) => {
  sessions.set(ctx.chat.id, { fuels: new Set() });
  await chooseCity(ctx);
});

bot.action(/^city:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const city = ctx.match[1];
  const current = session(ctx.chat!.id);
  current.city = city;
  current.station = undefined;
  current.fuels.clear();
  const stations = await getStations(city);
  if (!stations.length) return ctx.editMessageText("В этом городе пока нет АЗС. Нажмите /report и выберите другой город.");
  await ctx.editMessageText(`Город: ${city}. Выберите АЗС из списка:` , stationKeyboard(stations));
  await ctx.reply(
    "Или отправьте геолокацию — я покажу ближайшие АЗС.",
    Markup.keyboard([[Markup.button.locationRequest("📍 Отправить геолокацию")]]).resize().oneTime(),
  );
});

bot.on("location", async (ctx) => {
  const current = session(ctx.chat.id);
  if (!current.city) return chooseCity(ctx);
  const stations = await getStations(current.city);
  const distances = new Map(stations.map((station) => [station.id, distanceKm(ctx.message.location.latitude, ctx.message.location.longitude, station.latitude, station.longitude)]));
  const nearest = [...stations].sort((a, b) => distances.get(a.id)! - distances.get(b.id)!).slice(0, 8);
  await ctx.reply("Геолокация получена.", Markup.removeKeyboard());
  await ctx.reply("Ближайшие АЗС:", stationKeyboard(nearest, distances));
});

bot.action(/^station:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.match[1] === "change") {
    const current = session(ctx.chat!.id);
    if (!current.city) return chooseCity(ctx);
    const stations = await getStations(current.city);
    return ctx.editMessageText("Выберите АЗС:", stationKeyboard(stations));
  }
  const current = session(ctx.chat!.id);
  if (!current.city) return chooseCity(ctx);
  const stations = await getStations(current.city);
  const station = stations.find((item) => item.id === ctx.match[1]);
  if (!station) return ctx.reply("АЗС не найдена. Начните заново: /report");
  current.station = station;
  current.fuels.clear();
  await ctx.editMessageText(
    `<b>${station.brand} — ${station.name}</b>\n${station.address}\n\nОтметьте всё топливо, которое сейчас есть:`,
    { parse_mode: "HTML", ...fuelKeyboard(current.fuels) },
  );
});

bot.action(/^fuel:(ai92|ai95|diesel|gas)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const current = session(ctx.chat!.id);
  if (!current.station) return ctx.reply("Сначала выберите АЗС: /report");
  const fuel = ctx.match[1] as FuelKey;
  current.fuels.has(fuel) ? current.fuels.delete(fuel) : current.fuels.add(fuel);
  await ctx.editMessageReplyMarkup(fuelKeyboard(current.fuels).reply_markup);
});

bot.action("report:send", async (ctx) => {
  await ctx.answerCbQuery("Отправляю…");
  const current = session(ctx.chat!.id);
  if (!current.station) return ctx.reply("Сначала выберите АЗС: /report");
  const user = ctx.from;
  const { error } = await supabase.from("pending_reports").insert({
    station_id: current.station.id,
    ai92: current.fuels.has("ai92"),
    ai95: current.fuels.has("ai95"),
    diesel: current.fuels.has("diesel"),
    gas: current.fuels.has("gas"),
    reporter_name: [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 80),
    source: "Telegram",
    telegram_user_id: user.id,
    telegram_username: user.username ?? null,
  });
  if (error) throw error;
  sessions.set(ctx.chat!.id, { fuels: new Set() });
  await ctx.editMessageText("✅ Спасибо! Отчёт отправлен модератору. После проверки статус появится на карте.");
  await ctx.reply("Чтобы отправить ещё один отчёт, нажмите /report", Markup.removeKeyboard());
});

bot.catch(async (error, ctx) => {
  console.error("Ошибка обработки Telegram-события", error);
  await ctx.reply("Что-то пошло не так. Попробуйте ещё раз командой /report.").catch(() => undefined);
});

bot.launch().then(() => console.log("Telegram-бот запущен"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
