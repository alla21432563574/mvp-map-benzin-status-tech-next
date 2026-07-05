import { stationDisplayStatus } from "./map-utils";
import type { RankedStation } from "./smart-ranking";
import { filterFuelLabels, type FilterFuelKey } from "./types";

export type SmartPickResult =
  | { state: "ready"; item: RankedStation; explanation: string }
  | { state: "unreliable"; explanation: string }
  | { state: "empty"; explanation: string };

type SmartPickContext = {
  selectedFuels: ReadonlySet<FilterFuelKey>;
  now: number;
};

// Рейтинг отвечает на вопрос «кто выше», а этот модуль — «можно ли честно
// рекомендовать победителя». Пороговые значения собраны здесь, чтобы продукт
// мог менять строгость рекомендации независимо от компонентов интерфейса.
const RELIABILITY = {
  minimumConfidence: 52,
  minimumScore: 43,
  maximumDistanceKm: 80,
} as const;

function explanationFor(item: RankedStation, selectedFuels: ReadonlySet<FilterFuelKey>, now: number) {
  const ageMinutes = Math.max(0, (now - new Date(item.lastConfirmationAt).getTime()) / 60_000);
  if (selectedFuels.size && item.confidence >= 75) return "Высокая уверенность и есть выбранное топливо";
  if (item.distance <= 8 && ageMinutes <= 60) return "Ближайшая АЗС с подтверждённым топливом";
  if (ageMinutes <= 20) return "Самые свежие данные рядом";
  if (item.confidence >= 82) return "Высокая уверенность в наличии топлива";
  return "Лучший баланс расстояния и актуальности";
}

export function selectSmartPick(items: RankedStation[], context: SmartPickContext): SmartPickResult {
  if (!items.length) return { state: "empty", explanation: "В текущей области нет АЗС." };

  const selected = [...context.selectedFuels];
  const matchingFuel = selected.length
    ? items.filter(({ station }) => selected.every((fuel) => station[fuel] === true))
    : items;

  if (!matchingFuel.length) {
    const fuelNames = selected.map((fuel) => filterFuelLabels[fuel]).join(", ");
    return { state: "unreliable", explanation: `Нет АЗС с подтверждённым наличием: ${fuelNames}.` };
  }

  const candidates = matchingFuel.filter(({ station }) => {
    const status = stationDisplayStatus(station).kind;
    return status === "available" || status === "partial";
  });
  const item = candidates[0];

  if (!item) return { state: "unreliable", explanation: "Нет станций с подтверждённым наличием топлива." };
  if (item.confidence < RELIABILITY.minimumConfidence || item.score < RELIABILITY.minimumScore || item.distance > RELIABILITY.maximumDistanceKm) {
    return { state: "unreliable", explanation: "Данные рядом недостаточно свежие или надёжные для рекомендации." };
  }

  return { state: "ready", item, explanation: explanationFor(item, context.selectedFuels, context.now) };
}
