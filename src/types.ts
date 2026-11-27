export type HistoryPeriod = "day" | "week" | "month";

export interface Measurement {
  timestamp: string;
  voltage_v: number;
  current_a: number;
  power_kw: number;
  energy_kwh: number;
  power_factor: number;
}

export interface EnergyPoint {
  timestamp: string;
  label: string;
  consumption_kwh: number;
  power_kw: number;
}

export interface DashboardPayload {
  generated_at: string;
  latest: Measurement;
  summary: {
    today_kwh: number;
    month_kwh: number;
    peak_hour: {
      label: string;
      consumption_kwh: number;
    };
  };
  series: Record<HistoryPeriod, EnergyPoint[]>;
}
