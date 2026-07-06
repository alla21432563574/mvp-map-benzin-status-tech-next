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
  station_status?: "available" | "partial" | "unavailable" | "unknown" | null;
  ai92: boolean | null;
  ai95: boolean | null;
  ai98?: boolean | null;
  ai100?: boolean | null;
  diesel: boolean | null;
  gas: boolean | null;
  has_queue?: boolean | null;
  queue_count?: number | null;
  latest_report_status?: "available" | "partial" | "unavailable" | "unknown" | null;
  latest_report_at?: string | null;
  updated_at: string;
  update_source: string;
};

export type StationHistoryEntry = {
  id: string;
  status: "available" | "partial" | "unavailable" | "unknown";
  label: string;
  confirmed_at: string;
  source: string;
  fuel_type?: string | null;
  fuel_types?: string[];
  queue?: number | null;
  queue_text?: string | null;
  comment?: string | null;
  is_on_site?: boolean | null;
};

export type StationReportSummary = {
  available: number;
  unavailable: number;
  partial: number;
  on_site: number;
};

export type StationDetails = {
  confidence: number;
  confidence_status?: "calculated" | "insufficient";
  confirmation_count: number;
  last_24h_report_count?: number;
  unique_confirmers: number;
  last_confirmation_at: string;
  source: string;
  history: StationHistoryEntry[];
  last_hour_summary?: StationReportSummary;
  factors: {
    freshness: number;
    confirmations: number;
    consistency: number;
    confirmers: number;
    coverage: number;
  };
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
