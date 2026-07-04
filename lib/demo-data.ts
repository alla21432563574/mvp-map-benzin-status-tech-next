import type { Station } from "./types";

export const demoStations: Station[] = [
  { id: "demo-1", name: "АЗС Луговая", address: "ул. Луговая, 18", latitude: 55.7557, longitude: 37.6175, brand: "Энергия", ai92: true, ai95: true, diesel: true, gas: false, updated_at: "2026-07-03T07:42:00.000Z", update_source: "Оператор АЗС" },
  { id: "demo-2", name: "АЗС Садовое кольцо", address: "ул. Земляной Вал, 42", latitude: 55.7507, longitude: 37.6592, brand: "Пульс", ai92: true, ai95: false, diesel: true, gas: null, updated_at: "2026-07-03T06:18:00.000Z", update_source: "Пользователь" },
  { id: "demo-3", name: "АЗС Северная", address: "Ленинградский проспект, 35", latitude: 55.7874, longitude: 37.5579, brand: "Энергия", ai92: false, ai95: false, diesel: true, gas: false, updated_at: "2026-07-03T04:05:00.000Z", update_source: "Пользователь" },
  { id: "demo-4", name: "АЗС Речная", address: "Берсеневская наб., 6", latitude: 55.7404, longitude: 37.6091, brand: "Маршрут", ai92: false, ai95: false, diesel: false, gas: false, updated_at: "2026-07-02T21:30:00.000Z", update_source: "Оператор АЗС" },
  { id: "demo-5", name: "АЗС Восток", address: "ш. Энтузиастов, 12", latitude: 55.7471, longitude: 37.6928, brand: "Пульс", ai92: true, ai95: true, diesel: false, gas: true, updated_at: "2026-07-03T07:16:00.000Z", update_source: "Пользователь" },
  { id: "demo-6", name: "АЗС Университет", address: "Ломоносовский проспект, 25", latitude: 55.7047, longitude: 37.5297, brand: "Маршрут", ai92: null, ai95: null, diesel: null, gas: null, updated_at: "2026-07-01T15:10:00.000Z", update_source: "Нет свежих данных" },
];
