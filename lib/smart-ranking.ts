import { brandOptions, stationBrandId, stationDisplayStatus } from "./map-utils";
import { filterFuelLabels, type FilterFuelKey, type Station } from "./types";

export type RankingSignal = {
  confirmationCount: number;
  uniqueConfirmers: number;
  consistency: number;
  lastConfirmationAt: string | null;
};

export type RankedStation = {
  station: Station;
  distance: number;
  score: number;
  confidence: number;
  confirmationCount: number;
  lastConfirmationAt: string;
  reason: string;
};

export type RankingContext = {
  selectedFuels: ReadonlySet<FilterFuelKey>;
  brandAffinity: Readonly<Record<string, number>>;
  signals: ReadonlyMap<string, RankingSignal>;
  now: number;
};

// Веса намеренно собраны здесь: продукт может менять приоритеты без правок UI.
const WEIGHTS = {
  distance: 26,
  overallStatus: 16,
  selectedFuel: 24,
  confidence: 15,
  freshness: 10,
  confirmations: 5,
  knownBrand: 2,
  affinity: 2,
  queue: 4,
} as const;

function freshness(value: string, now: number) {
  const hours = Math.max(0, (now - new Date(value).getTime()) / 3_600_000);
  if (hours <= 0.25) return 1;
  if (hours <= 1) return 0.94;
  if (hours <= 6) return 0.85;
  if (hours <= 24) return 0.7;
  if (hours <= 72) return 0.45;
  return 0.2;
}

function estimatedConfidence(station: Station, signal: RankingSignal | undefined, now: number) {
  const confirmationCount = signal?.confirmationCount ?? 1;
  const uniqueConfirmers = signal?.uniqueConfirmers ?? 1;
  const knownFuelCount = [station.ai92, station.ai95, station.ai98, station.ai100, station.diesel, station.gas].filter((value) => typeof value === "boolean").length;
  const factors = {
    freshness: freshness(signal?.lastConfirmationAt || station.updated_at, now),
    confirmations: Math.min(1, Math.log2(confirmationCount + 1) / Math.log2(16)),
    consistency: signal?.consistency ?? 0.55,
    confirmers: Math.min(1, uniqueConfirmers / 5),
    coverage: knownFuelCount / 6,
  };
  return Math.round(100 * (factors.freshness * 0.45 + factors.confirmations * 0.2 + factors.consistency * 0.2 + factors.confirmers * 0.1 + factors.coverage * 0.05));
}

function recommendationReason(station: Station, distance: number, confidence: number, selectedFuels: ReadonlySet<FilterFuelKey>, lastConfirmationAt: string, now: number) {
  const selected = [...selectedFuels];
  if (selected.length === 1 && station[selected[0]] === true) return `Есть ${filterFuelLabels[selected[0]]}`;
  if (confidence >= 85) return "Высокая уверенность";
  const ageMinutes = Math.max(0, (now - new Date(lastConfirmationAt).getTime()) / 60_000);
  if (ageMinutes <= 15) return "Самые свежие данные";
  if (ageMinutes <= 60) return "Недавно подтверждено";
  if (distance <= 2) return "Ближайшая АЗС";
  return "Лучший вариант рядом";
}

export function rankStations(items: Array<{ station: Station; distance: number }>, context: RankingContext): RankedStation[] {
  const selected = [...context.selectedFuels];
  return items.map(({ station, distance }) => {
    const signal = context.signals.get(station.id);
    const confidence = estimatedConfidence(station, signal, context.now);
    const lastConfirmationAt = signal?.lastConfirmationAt || station.updated_at;
    const status = stationDisplayStatus(station).kind;
    const statusScore = status === "available" ? 1 : status === "partial" ? 0.68 : status === "unknown" ? 0.15 : 0;
    const selectedValues = selected.map((fuel) => station[fuel]);
    const selectedFuelScore = !selected.length ? 0.5 : selectedValues.every((value) => value === true) ? 1 : selectedValues.some((value) => value === true) ? 0.45 : selectedValues.some((value) => value === false) ? -0.65 : -0.25;
    const brandId = stationBrandId(station);
    const knownBrand = brandOptions.some((brand) => brand.id === brandId) ? 1 : 0;
    const affinity = Math.min(1, (context.brandAffinity[brandId] || 0) / 8);
    const confirmationCount = signal?.confirmationCount ?? 1;
    const queueScore = typeof station.queue_count === "number" ? 1 / (1 + station.queue_count / 3) : station.has_queue === false ? 1 : station.has_queue === true ? 0.2 : 0.55;
    const score =
      (1 / (1 + distance / 4)) * WEIGHTS.distance +
      statusScore * WEIGHTS.overallStatus +
      selectedFuelScore * WEIGHTS.selectedFuel +
      (confidence / 100) * WEIGHTS.confidence +
      freshness(lastConfirmationAt, context.now) * WEIGHTS.freshness +
      Math.min(1, Math.log2(confirmationCount + 1) / Math.log2(16)) * WEIGHTS.confirmations +
      knownBrand * WEIGHTS.knownBrand +
      affinity * WEIGHTS.affinity +
      queueScore * WEIGHTS.queue;
    return {
      station,
      distance,
      score,
      confidence,
      confirmationCount,
      lastConfirmationAt,
      reason: recommendationReason(station, distance, confidence, context.selectedFuels, lastConfirmationAt, context.now),
    };
  }).sort((left, right) => right.score - left.score || left.distance - right.distance);
}

export function isStrongRecommendation(item: RankedStation | undefined, selectedFuels: ReadonlySet<FilterFuelKey>) {
  if (!item || item.distance > 50 || item.confidence < 58 || item.score < 48) return false;
  if (selectedFuels.size && ![...selectedFuels].every((fuel) => item.station[fuel] === true)) return false;
  return stationDisplayStatus(item.station).kind === "available" || stationDisplayStatus(item.station).kind === "partial";
}
