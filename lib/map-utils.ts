import { filterFuelKeys, filterFuelLabels, type FilterFuelKey, type Station } from "./types";

export type MapPoint = { latitude: number; longitude: number };

export const brandOptions = [
  { id: "lukoil", label: "Лукойл", aliases: ["лукойл", "lukoil"] },
  { id: "gazprom", label: "Газпром", aliases: ["газпром", "gazprom"] },
  { id: "rosneft", label: "Роснефть", aliases: ["роснефть", "rosneft"] },
  { id: "tatneft", label: "Татнефть", aliases: ["татнефть", "tatneft"] },
  { id: "bashneft", label: "Башнефть", aliases: ["башнефть", "bashneft"] },
  { id: "shell", label: "Shell", aliases: ["shell", "шелл"] },
  { id: "teboil", label: "Teboil", aliases: ["teboil", "тебойл"] },
  { id: "irbis", label: "Ирбис", aliases: ["ирбис", "irbis"] },
  { id: "neftmagistral", label: "Нефтьмагистраль", aliases: ["нефтьмагистраль", "нефтмагистраль", "neftmagistral"] },
] as const;

export function stationBrandId(station: Pick<Station, "brand" | "name">) {
  const value = `${station.brand} ${station.name}`.toLocaleLowerCase("ru");
  return brandOptions.find((brand) => brand.aliases.some((alias) => value.includes(alias)))?.id ?? "other";
}

export function distanceKm(from: MapPoint, station: Pick<Station, "latitude" | "longitude">) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(station.latitude - from.latitude);
  const deltaLongitude = radians(station.longitude - from.longitude);
  const latitude1 = radians(from.latitude);
  const latitude2 = radians(station.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(distance: number) {
  return distance < 1 ? `${Math.max(10, Math.round(distance * 1000 / 10) * 10)} м` : `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} км`;
}

export function relativeTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "время неизвестно";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

function plural(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function stationHasFuel(station: Station, fuel: FilterFuelKey) {
  return station[fuel] === true;
}

export type StationStatusKind = "available" | "partial" | "unavailable" | "unknown";

export type StationDisplayStatus = {
  kind: StationStatusKind;
  label: string;
};

export function stationDisplayStatus(station: Station, selectedFuels: ReadonlySet<FilterFuelKey> = new Set()): StationDisplayStatus {
  const selected = [...selectedFuels];
  if (selected.length === 1) {
    const fuel = selected[0];
    const value = station[fuel];
    if (value === true) return { kind: "available", label: `${filterFuelLabels[fuel]} есть` };
    if (value === false) return { kind: "unavailable", label: `${filterFuelLabels[fuel]} нет` };
    return { kind: "unknown", label: `${filterFuelLabels[fuel]}: нет данных` };
  }

  const fuels = selected.length ? selected : [...filterFuelKeys];
  const values = fuels.map((fuel) => station[fuel]);
  const known = values.filter((value): value is boolean => typeof value === "boolean");
  if (known.length === 0) return { kind: "unknown", label: "Нет данных" };

  const availableCount = known.filter(Boolean).length;
  if (availableCount === 0) {
    if (selected.length && known.length < values.length) return { kind: "unknown", label: "Нет данных" };
    return { kind: "unavailable", label: selected.length ? "Выбранного топлива нет" : "Нет топлива" };
  }
  if (availableCount === known.length) {
    return { kind: "available", label: selected.length ? "Выбранное топливо есть" : "Есть топливо" };
  }
  return { kind: "partial", label: "Частично" };
}

export function brandInitials(brand: string) {
  return brand.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru") || "АЗС";
}
