import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bolt,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Gauge,
  LayoutDashboard,
  Moon,
  Radio,
  RefreshCw,
  Sun,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchDashboard,
  fetchHistory,
  isMeasurement,
  liveSocketUrl,
} from "./api";
import type {
  DashboardPayload,
  EnergyPoint,
  HistoryPeriod,
} from "./types";

type ConnectionState = "connecting" | "live" | "offline";
type Theme = "light" | "dark";

const DEVICE_STALE_AFTER_MS = 15_000;

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: "day", label: "24 jam" },
  { value: "week", label: "7 hari" },
  { value: "month", label: "30 hari" },
];

const numberFormat = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const compactNumberFormat = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatTime(timestamp?: string): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(timestamp));
}

function isDeviceActive(timestamp: string | undefined, now: Date): boolean {
  if (!timestamp) return false;
  const updatedAt = Date.parse(timestamp);
  const age = now.getTime() - updatedAt;
  return Number.isFinite(updatedAt) && age >= 0 && age <= DEVICE_STALE_AFTER_MS;
}

function formatDate(timestamp: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(timestamp);
}

function periodDescription(period: HistoryPeriod): string {
  if (period === "day") return "Konsumsi energi per jam · 24 jam terakhir";
  if (period === "week") return "Rekap konsumsi energi · 7 hari terakhir";
  return "Rekap konsumsi energi · 30 hari terakhir";
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const label =
    state === "live"
      ? "Terhubung realtime"
      : state === "offline"
        ? "Data belum tersedia"
        : "Menghubungkan";

  return (
    <span className={`connection-badge connection-${state}`}>
      <span className="connection-dot" />
      {label}
    </span>
  );
}

function MetricCard({
  title,
  value,
  unit,
  note,
  icon,
  tone,
}: {
  title: string;
  value: string;
  unit: string;
  note: string;
  icon: ReactNode;
  tone: "blue" | "amber" | "violet" | "green";
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <span className={`metric-icon metric-icon-${tone}`}>{icon}</span>
      </div>
      <p className="metric-title">{title}</p>
      <div className="metric-value-line">
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      <p className="metric-note">{note}</p>
    </article>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("pantau-daya-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [period, setPeriod] = useState<HistoryPeriod>("day");
  const [history, setHistory] = useState<EnergyPoint[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("pantau-daya-theme", theme);
  }, [theme]);

  useEffect(() => {
    let stopped = false;

    const refresh = async () => {
      try {
        const nextDashboard = await fetchDashboard();
        if (stopped) return;
        setDashboard(nextDashboard);
        setConnection("live");
      } catch {
        if (!stopped) setConnection("offline");
      }
    };

    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      stopped = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(liveSocketUrl());
      socket.onopen = () => setConnection("live");
      socket.onmessage = (event) => {
        try {
          const reading: unknown = JSON.parse(event.data);
          if (!isMeasurement(reading)) return;
          setDashboard((current) =>
            current ? { ...current, latest: reading } : current,
          );
        } catch {
          // Ignore malformed messages and keep the last valid reading.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setConnection((current) => (current === "live" ? "offline" : current));
        reconnectTimer = window.setTimeout(connect, 5_000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const loadHistory = async () => {
      if (connection === "live") {
        try {
          const result = await fetchHistory(period);
          if (!stopped) {
            setHistory(result.points);
            return;
          }
        } catch {
          // Fall back to the history bundled with the dashboard response.
        }
      }
      if (!stopped) setHistory(dashboard?.series[period] ?? []);
    };

    void loadHistory();
    const refreshTimer =
      connection === "live"
        ? window.setInterval(() => void loadHistory(), 30_000)
        : undefined;
    return () => {
      stopped = true;
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  }, [connection, dashboard?.series, period]);

  const latest = dashboard?.latest;
  const deviceActive = isDeviceActive(latest?.timestamp, now);
  const formattedDate = useMemo(() => formatDate(now), [now]);
  const energyToday = dashboard?.summary.today_kwh;
  const energyMonth = dashboard?.summary.month_kwh;
  const peakHour = dashboard?.summary.peak_hour;
  const weeklySeries = dashboard?.series.week ?? [];
  const weeklyMaximum = Math.max(
    0.1,
    ...weeklySeries.map((point) => point.consumption_kwh),
  );
  const weeklySparkline = (tone: "blue" | "violet") => (
    <div className={`summary-sparkline sparkline-${tone}`} aria-hidden="true">
      {weeklySeries.map((point) => (
        <span
          key={point.timestamp}
          style={{
            height: `${Math.max(14, (point.consumption_kwh / weeklyMaximum) * 100)}%`,
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Pantau Daya, beranda">
          <span className="brand-mark">
            <Zap size={21} fill="currentColor" />
          </span>
          <span className="brand-copy">
            <strong>pantau<span>daya</span></strong>
            <small>ENERGY MONITOR</small>
          </span>
        </a>

        <div className="sidebar-label">MENU UTAMA</div>
        <nav className="side-nav" aria-label="Navigasi utama">
          <a className="side-nav-link active" href="#overview">
            <LayoutDashboard size={18} />
            Ringkasan
          </a>
          <a className="side-nav-link" href="#history">
            <ChartNoAxesCombined size={18} />
            Analitik historis
          </a>
        </nav>

        <div className="sidebar-device">
          <div className="device-topline">
            <span className="device-icon"><Bolt size={16} /></span>
            <span className={`device-status ${connection}`}>
              <i />
              {connection === "live" ? "ONLINE" : connection === "offline" ? "OFFLINE" : "CONNECTING"}
            </span>
          </div>
          <strong>Panel listrik utama</strong>
          <span>Meter energi · 1 phase</span>
          <div className="device-footer">
            <span>Update terakhir</span>
            <b>{formatTime(latest?.timestamp)}</b>
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-help-icon"><Activity size={17} /></div>
          <div>
            <strong>Butuh bantuan?</strong>
            <span>Dashboard monitoring v1</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="top">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark"><Zap size={18} fill="currentColor" /></span>
            <strong>pantau<span>daya</span></strong>
          </div>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>Monitoring energi</strong>
          </div>
          <div className="topbar-right">
            <button
              aria-label={theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
              className="theme-toggle"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
              type="button"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <ConnectionBadge state={connection} />
            <div className="avatar" aria-label="Pengguna">PD</div>
          </div>
        </header>

        <div className="page-content" id="overview">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span /> SISTEM MONITORING LISTRIK</div>
              <h1>Monitoring energi</h1>
              <p>Pantau kondisi listrik dan konsumsi energi secara langsung.</p>
            </div>
            <div className="date-chip">
              <CalendarDays size={17} />
              <span>{formattedDate}</span>
            </div>
          </section>

          <section className="live-overview">
            <div className="live-overview-copy">
              <div className="live-title">
                <span className="pulse-icon"><Radio size={17} /></span>
                <span>PEMANTAUAN LANGSUNG</span>
                <span className="live-tag">REALTIME</span>
              </div>
              <h2>
                {latest ? `${numberFormat.format(latest.power_kw)} kW` : "— kW"}
              </h2>
              <p>Daya aktif saat ini</p>
              <div className="live-updated">
                <Clock3 size={14} />
                Diperbarui pukul {formatTime(latest?.timestamp)} WIB
              </div>
            </div>
            <div className="live-overview-graphic" aria-hidden="true">
              <div className="orbit orbit-outer" />
              <div className="orbit orbit-inner" />
              <div className="live-bolt"><Zap size={32} fill="currentColor" /></div>
              <span className="orbit-dot orbit-dot-one" />
              <span className="orbit-dot orbit-dot-two" />
              <span className="orbit-dot orbit-dot-three" />
            </div>
            <div className="live-side-stats">
              <div>
                <span>Energi hari ini</span>
                <strong>{energyToday === undefined ? "—" : compactNumberFormat.format(energyToday)} <small>kWh</small></strong>
              </div>
              <div>
                <span>Faktor daya</span>
                <strong>{latest ? numberFormat.format(latest.power_factor) : "—"}</strong>
              </div>
            </div>
          </section>

          <section className="section-block" aria-labelledby="electrical-heading">
            <div className="section-heading">
              <div>
                <h2 id="electrical-heading">Parameter listrik</h2>
                <p>Nilai pengukuran terkini dari panel utama</p>
              </div>
              <span className="updated-label">
                <span />
                {connection === "live" ? "Live data" : connection === "offline" ? "API offline" : "Menghubungkan"}
              </span>
            </div>
            <div className="metric-grid">
              <MetricCard
                title="Tegangan"
                value={latest ? numberFormat.format(latest.voltage_v) : "—"}
                unit="V"
                note="Tegangan RMS"
                icon={<Bolt size={18} />}
                tone="blue"
              />
              <MetricCard
                title="Arus"
                value={latest ? numberFormat.format(latest.current_a) : "—"}
                unit="A"
                note="Arus beban"
                icon={<Activity size={18} />}
                tone="violet"
              />
              <MetricCard
                title="Daya aktif"
                value={latest ? numberFormat.format(latest.power_kw) : "—"}
                unit="kW"
                note="Konsumsi saat ini"
                icon={<Zap size={18} />}
                tone="amber"
              />
              <MetricCard
                title="Faktor daya"
                value={latest ? numberFormat.format(latest.power_factor) : "—"}
                unit="PF"
                note="Power factor"
                icon={<Gauge size={18} />}
                tone="green"
              />
            </div>
          </section>

          <section className="summary-grid" aria-label="Ringkasan konsumsi">
            <article className="summary-card">
              <div className="summary-icon summary-icon-blue"><Zap size={18} /></div>
              <div className="summary-copy">
                <span>Konsumsi hari ini</span>
                <strong>{energyToday === undefined ? "—" : compactNumberFormat.format(energyToday)} <small>kWh</small></strong>
                <em>Dihitung dari data historis hari ini</em>
              </div>
              {weeklySparkline("blue")}
            </article>
            <article className="summary-card">
              <div className="summary-icon summary-icon-violet"><CalendarDays size={18} /></div>
              <div className="summary-copy">
                <span>Konsumsi bulan ini</span>
                <strong>{energyMonth === undefined ? "—" : compactNumberFormat.format(energyMonth)} <small>kWh</small></strong>
                <em>Akumulasi bulan berjalan</em>
              </div>
              {weeklySparkline("violet")}
            </article>
            <article className="summary-card peak-card">
              <div className="summary-icon summary-icon-amber"><ChartNoAxesCombined size={18} /></div>
              <div className="summary-copy">
                <span>Jam konsumsi tertinggi</span>
                <strong>{peakHour?.label ?? "—"}</strong>
                <em>
                  {peakHour
                    ? `${compactNumberFormat.format(peakHour.consumption_kwh)} kWh pada jam tersebut`
                    : "Belum ada data historis"}
                </em>
              </div>
            </article>
          </section>

          <section className="section-block chart-section" id="history">
            <div className="section-heading chart-heading">
              <div>
                <div className="heading-with-icon">
                  <span className="heading-icon"><ChartNoAxesCombined size={18} /></span>
                  <h2>Historis konsumsi energi</h2>
                </div>
                <p>{periodDescription(period)}</p>
              </div>
              <div className="period-switch" role="group" aria-label="Periode historis">
                {PERIODS.map((option) => (
                  <button
                    className={period === option.value ? "selected" : ""}
                    key={option.value}
                    onClick={() => setPeriod(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-legend">
              <span><i className="legend-energy" /> Konsumsi energi (kWh)</span>
              <span><i className="legend-power" /> Daya rata-rata (kW)</span>
            </div>
            <div className="main-chart">
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={history} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="energyBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#36a2ff" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#36a2ff" stopOpacity={0.62} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke={theme === "dark" ? "#29384b" : "#edf1f6"}
                      strokeDasharray="4 5"
                      vertical={false}
                    />
                    <XAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: theme === "dark" ? "#9aa9bd" : "#8b96a8", fontSize: 11 }}
                      dataKey="label"
                      minTickGap={18}
                    />
                    <YAxis
                      yAxisId="energy"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: theme === "dark" ? "#9aa9bd" : "#8b96a8", fontSize: 11 }}
                      width={48}
                    />
                    <YAxis
                      yAxisId="power"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: theme === "dark" ? "#9aa9bd" : "#8b96a8", fontSize: 11 }}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        color: theme === "dark" ? "#e5edf7" : undefined,
                        background: theme === "dark" ? "#182536" : undefined,
                        border: `1px solid ${theme === "dark" ? "#34465d" : "#e9eef5"}`,
                        borderRadius: 12,
                        boxShadow: "0 10px 28px rgba(24, 44, 76, 0.12)",
                        fontSize: 12,
                      }}
                    />
                    <Bar
                      yAxisId="energy"
                      dataKey="consumption_kwh"
                      name="Energi"
                      fill="url(#energyBar)"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={30}
                    />
                    <Line
                      yAxisId="power"
                      dataKey="power_kw"
                      name="Daya rata-rata"
                      type="monotone"
                      stroke="#f2a93b"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-chart">
                  <ChartNoAxesCombined size={28} />
                  <strong>Menunggu data historis</strong>
                  <span>Pastikan API tersedia untuk memuat data historis.</span>
                </div>
              )}
            </div>
            <div className="chart-footer">
              <span><RefreshCw size={13} /> Data diperbarui berkala</span>
              <span>{history.length} titik data</span>
            </div>
          </section>

          <section className="bottom-grid">
            <article className="panel-card usage-panel">
              <div className="panel-heading">
                <div>
                  <h2>Profil beban</h2>
                  <p>Perubahan daya rata-rata pada periode terpilih</p>
                </div>
                <span className="panel-heading-icon"><Activity size={17} /></span>
              </div>
              <div className="usage-chart">
                {history.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="powerArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#78bdff" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#78bdff" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke={theme === "dark" ? "#29384b" : "#edf1f6"}
                        strokeDasharray="4 5"
                        vertical={false}
                      />
                      <XAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: theme === "dark" ? "#9aa9bd" : "#8b96a8", fontSize: 10 }}
                        dataKey="label"
                        minTickGap={24}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: theme === "dark" ? "#9aa9bd" : "#8b96a8", fontSize: 10 }}
                        width={48}
                      />
                      <Tooltip
                        contentStyle={{
                          color: theme === "dark" ? "#e5edf7" : undefined,
                          background: theme === "dark" ? "#182536" : undefined,
                          border: `1px solid ${theme === "dark" ? "#34465d" : "#e9eef5"}`,
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Area
                        dataKey="power_kw"
                        name="Daya rata-rata (kW)"
                        type="monotone"
                        stroke="#4499ed"
                        strokeWidth={2.5}
                        fill="url(#powerArea)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-chart compact-empty">Belum ada data untuk ditampilkan.</div>
                )}
              </div>
            </article>

            <article className="panel-card meter-panel">
              <div className="panel-heading">
                <div>
                  <h2>Meter energi</h2>
                  <p>Akumulasi energi pada meter</p>
                </div>
                <span className="panel-heading-icon meter-heading-icon"><Gauge size={17} /></span>
              </div>
              <div className="meter-reading">
                <span className="meter-reading-icon"><Zap size={18} /></span>
                <div>
                  <strong>{latest ? numberFormat.format(latest.energy_kwh) : "—"}</strong>
                  <span>kWh tercatat</span>
                </div>
              </div>
              <div className="meter-details">
                <div>
                  <span>Status perangkat</span>
                  <strong className={deviceActive ? "active" : "inactive"}>
                    <i /> {deviceActive ? "Aktif" : "Tidak aktif"}
                  </strong>
                </div>
                <div><span>Waktu pembaruan</span><strong>{formatTime(latest?.timestamp)} WIB</strong></div>
                <div><span>Sumber data</span><strong>{dashboard ? "API" : "—"}</strong></div>
              </div>
            </article>
          </section>

          <footer className="page-footer">
            <span>© {now.getFullYear()} Pantau Daya · Dashboard monitoring energi</span>
            <span>Zona waktu: WIB (UTC+7)</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
