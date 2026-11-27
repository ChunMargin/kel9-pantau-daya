import type { DashboardPayload, HistoryPeriod, Measurement } from "./types";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Permintaan gagal (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(): Promise<DashboardPayload> {
  return requestJson<DashboardPayload>(`${API_BASE_URL}/api/dashboard`);
}

export function fetchHistory(period: HistoryPeriod): Promise<{
  period: HistoryPeriod;
  points: DashboardPayload["series"][HistoryPeriod];
}> {
  return requestJson(
    `${API_BASE_URL}/api/history?period=${encodeURIComponent(period)}`,
  );
}

export function liveSocketUrl(): string {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/live";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isMeasurement(value: unknown): value is Measurement {
  if (!value || typeof value !== "object") return false;
  const reading = value as Partial<Measurement>;
  return (
    typeof reading.timestamp === "string" &&
    typeof reading.voltage_v === "number" &&
    typeof reading.current_a === "number" &&
    typeof reading.power_kw === "number" &&
    typeof reading.energy_kwh === "number" &&
    typeof reading.power_factor === "number"
  );
}
