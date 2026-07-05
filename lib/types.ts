export const fuelKeys = ["ai92", "ai95", "diesel", "gas"] as const;
export type FuelKey = (typeof fuelKeys)[number];

export const filterFuelKeys = ["ai92", "ai95", "ai98", "ai100", "diesel", "gas"] as const;
export type FilterFuelKey = (typeof filterFuelKeys)[number];

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export const fuelLabels: Record<FuelKey, string> = {
  ai92: "АИ-92",
  ai95: "АИ-95",
  diesel: "Дизель",
  gas: "Газ",
};

export const filterFuelLabels: Record<FilterFuelKey, string> = {
  ai92: "АИ-92",
  ai95: "АИ-95",
  ai98: "АИ-98",
  ai100: "АИ-100",
  diesel: "ДТ",
  gas: "Газ",
};

export type Station = {
  id: string;
  city?: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  brand: string;
  ai92: boolean | null;
  ai95: boolean | null;
  ai98?: boolean | null;
  ai100?: boolean | null;
  diesel: boolean | null;
  gas: boolean | null;
  updated_at: string;
  update_source: string;
};

export type PendingReport = {
  id: string;
  station_id: string;
  ai92: boolean | null;
  ai95: boolean | null;
  diesel: boolean | null;
  gas: boolean | null;
  reporter_name: string | null;
  comment: string | null;
  source: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  station?: Pick<Station, "name" | "address" | "brand">;
};
