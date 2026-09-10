"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  Cpu,
  HardDrive,
  RefreshCw,
  Clock,
  ChevronDown,
  Layers,
} from "lucide-react";

interface VitalPoint {
  id?: number;
  process: string;
  processName?: string;
  processId?: string;
  cpu: number;
  memory: number; // in bytes
  timestamp: string;
}

interface ProcessOption {
  id: string | number;
  name: string;
}

const TIMEFRAMES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
];

export function VitalsChart() {
  const [mounted, setMounted] = useState(false);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<string>("pmmanager-web");
  const [selectedHours, setSelectedHours] = useState<number>(24);
  const [vitals, setVitals] = useState<VitalPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch available PM2 processes
  useEffect(() => {
    async function loadProcesses() {
      try {
        const res = await fetch("/api/pm2");
        if (res.ok) {
          const json = await res.json();
          if (json.processes && Array.isArray(json.processes) && json.processes.length > 0) {
            setProcesses(json.processes);
            // Default to first active process if current is not in list
            const currentInList = json.processes.some(
              (p: ProcessOption) => p.name === selectedProcess
            );
            if (!currentInList) {
              setSelectedProcess(json.processes[0].name);
            }
          } else {
            setProcesses([
              { id: 0, name: "pmmanager-web" },
              { id: 1, name: "web-app" },
              { id: 2, name: "api-server" },
            ]);
          }
        }
      } catch (err) {
        console.warn("Failed to load PM2 processes for vitals chart:", err);
      }
    }
    loadProcesses();
  }, []);

  // Fetch vitals history
  const fetchVitals = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setIsRefreshing(true);

      try {
        const procQuery = selectedProcess ? `process=${encodeURIComponent(selectedProcess)}&` : "";
        const res = await fetch(`/api/vitals/history?${procQuery}hours=${selectedHours}`);
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        const json = await res.json();
        setError(null);
        if (json.success && Array.isArray(json.data)) {
          setVitals(json.data);
        } else {
          setVitals([]);
        }
      } catch (err: any) {
        console.error("Error fetching vitals:", err);
        setError(err.message || "Failed to load vitals history");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [selectedProcess, selectedHours]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) {
        fetchVitals(false);
      }
    })();
    const interval = setInterval(() => {
      fetchVitals(false);
    }, 30000); // 30s auto-refresh
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchVitals]);

  // Format data for recharts
  const chartData = vitals.map((v) => {
    const d = new Date(v.timestamp);
    const timeLabel =
      selectedHours <= 24
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    const memoryMb = Number((v.memory / (1024 * 1024)).toFixed(1));

    return {
      time: timeLabel,
      rawTimestamp: v.timestamp,
      cpu: Number(v.cpu.toFixed(1)),
      memory: memoryMb,
    };
  });

  // Calculate summary stats
  const latestCpu = chartData.length > 0 ? chartData[chartData.length - 1].cpu : 0;
  const latestMem = chartData.length > 0 ? chartData[chartData.length - 1].memory : 0;
  const peakCpu = chartData.length > 0 ? Math.max(...chartData.map((d) => d.cpu)) : 0;
  const avgCpu =
    chartData.length > 0
      ? Number(
          (chartData.reduce((acc, d) => acc + d.cpu, 0) / chartData.length).toFixed(1)
        )
      : 0;

  if (!mounted) {
    return (
      <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl min-h-[350px] flex items-center justify-center">
        <Activity className="w-8 h-8 text-brand-400 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-brand-500/10 rounded-xl border border-brand-500/20 shadow-[0_0_15px_rgba(45,212,191,0.15)]">
            <Activity className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Historical Analytics
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Continuous CPU & Memory telemetry trends
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Process Selector */}
          {processes.length > 1 && (
            <div className="relative">
              <select
                value={selectedProcess}
                onChange={(e) => setSelectedProcess(e.target.value)}
                className="appearance-none bg-surface-900 border border-white/10 rounded-xl px-3 py-1.5 pr-8 text-xs font-medium text-slate-200 hover:border-brand-500/40 focus:outline-none focus:border-brand-400 transition-colors cursor-pointer"
              >
                {processes.map((proc) => (
                  <option key={proc.id} value={proc.name} className="bg-surface-900 text-white">
                    {proc.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}

          {/* Timeframe Buttons */}
          <div className="flex items-center bg-surface-950/70 p-1 rounded-xl border border-white/5">
            {TIMEFRAMES.map((tf) => {
              const active = selectedHours === tf.hours;
              return (
                <button
                  key={tf.label}
                  onClick={() => setSelectedHours(tf.hours)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    active
                      ? "bg-brand-500/20 text-brand-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] border border-brand-500/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => fetchVitals(true)}
            disabled={isRefreshing}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/5 transition-colors disabled:opacity-50"
            title="Refresh vitals now"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-brand-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-brand-400" /> Current CPU
          </span>
          <p className="text-lg font-bold text-white mt-1">{latestCpu.toFixed(1)}%</p>
        </div>
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-purple-400" /> Current RAM
          </span>
          <p className="text-lg font-bold text-white mt-1">{latestMem.toFixed(1)} MB</p>
        </div>
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" /> Peak CPU ({selectedHours}h)
          </span>
          <p className="text-lg font-bold text-white mt-1">{peakCpu.toFixed(1)}%</p>
        </div>
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-400" /> Avg CPU
          </span>
          <p className="text-lg font-bold text-white mt-1">{avgCpu.toFixed(1)}%</p>
        </div>
      </div>

      {/* Chart Section */}
      {isLoading ? (
        <div className="h-64 flex items-center justify-center border border-white/5 rounded-xl bg-surface-950/20 animate-pulse">
          <Activity className="w-6 h-6 text-brand-400 animate-spin" />
        </div>
      ) : error ? (
        <div className="h-64 flex flex-col items-center justify-center border border-red-500/20 bg-red-500/5 rounded-xl text-center p-4">
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button
            onClick={() => fetchVitals(true)}
            className="mt-3 px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors border border-red-500/30"
          >
            Retry
          </button>
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center border border-white/5 rounded-xl bg-surface-950/20 text-slate-400">
          <Activity className="w-8 h-8 opacity-40 mb-2" />
          <p className="text-sm">No historical data recorded for {selectedProcess}</p>
          <p className="text-xs text-slate-500 mt-1">
            Vitals are automatically polled in the background every 5 minutes
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* CPU Chart */}
          <div className="p-4 bg-surface-950/30 rounded-xl border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" /> CPU Utilization (%)
              </span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="time"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    domain={[0, (dataMax: number) => Math.max(10, Math.ceil(dataMax * 1.2))]}
                    unit="%"
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "0.75rem",
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                      fontSize: "12px",
                      color: "#fff",
                    }}
                    formatter={(value: any) => [`${value}%`, "CPU Usage"]}
                    labelStyle={{ color: "#94a3b8" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    stroke="#2dd4bf"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cpuGradient)"
                    name="CPU"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Memory Chart */}
          <div className="p-4 bg-surface-950/30 rounded-xl border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" /> Memory Consumption (MB)
              </span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="time"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    domain={["auto", "auto"]}
                    unit="MB"
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "0.75rem",
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                      fontSize: "12px",
                      color: "#fff",
                    }}
                    formatter={(value: any) => [`${value} MB`, "Memory Usage"]}
                    labelStyle={{ color: "#94a3b8" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="memory"
                    stroke="#a855f7"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#memGradient)"
                    name="Memory"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VitalsChart;
