"use client";

import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import {
  Activity,
  Play,
  Square,
  RotateCw,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Server,
  Cpu,
  Database,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

export interface PM2Process {
  id: number | string;
  name: string;
  pid: number;
  status: "online" | "stopped" | "errored";
  mode: "fork" | "cluster";
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  ports?: number[];
}

export interface PM2Summary {
  total: number;
  online: number;
  stopped: number;
  totalMemoryBytes: number;
  avgCpuPercent: number;
}

export interface PM2ListResponse {
  success: boolean;
  mode: "real" | "mock";
  timestamp: number;
  summary: PM2Summary;
  processes: PM2Process[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function formatUptime(uptime: number): string {
  if (!uptime || uptime <= 0) return "—";
  const diff = Math.max(0, Date.now() - uptime);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

const emptySubscribe = () => () => {};

export default function PM2Manager() {
  const [processes, setProcesses] = useState<PM2Process[]>([]);
  const [summary, setSummary] = useState<PM2Summary>({
    total: 0,
    online: 0,
    stopped: 0,
    totalMemoryBytes: 0,
    avgCpuPercent: 0,
  });
  const [mode, setMode] = useState<"real" | "mock">("mock");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number>(60);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/pm2", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to fetch PM2 status: HTTP ${res.status}`);
      }
      const data: PM2ListResponse = await res.json();
      if (data.success) {
        setProcesses(data.processes || []);
        setSummary(
          data.summary || {
            total: data.processes?.length || 0,
            online: data.processes?.filter((p) => p.status === "online").length || 0,
            stopped: data.processes?.filter((p) => p.status === "stopped").length || 0,
            totalMemoryBytes: 0,
            avgCpuPercent: 0,
          }
        );
        setMode(data.mode);
        setLastUpdated(data.timestamp || Date.now());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching PM2 data";
      console.error(msg);
      setStatusMessage({ type: "error", text: msg });
    }
  }, []);

  // Initial load & 60-second polling countdown timer
  useEffect(() => {
    const initTimer = setTimeout(() => {
      void loadData();
    }, 0);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void loadData();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [loadData]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setCountdown(60);
    try {
      await loadData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAction = async (
    action: "start" | "stop" | "restart",
    id: string | number
  ) => {
    const key = `${id}-${action}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    setStatusMessage(null);

    try {
      const res = await fetch("/api/pm2/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || `Action ${action} failed`);
      }

      setStatusMessage({
        type: "success",
        text: `Action "${action}" on process ${id} completed successfully (${data.mode} mode).`,
      });

      // Instantly refresh list to show updated state
      await loadData();
      setCountdown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute action";
      setStatusMessage({ type: "error", text: msg });
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Prepare chart data
  const chartData = processes.map((p) => ({
    name: p.name,
    cpu: p.cpu,
    memoryMB: Number((p.memory / (1024 * 1024)).toFixed(1)),
    status: p.status,
  }));

  return (
    <div className="space-y-6">
      {/* PM2 Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-emerald-600 dark:text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                PM2 Process Manager
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  mode === "real"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    mode === "real" ? "bg-emerald-500 animate-pulse" : "bg-blue-500"
                  }`}
                />
                {mode === "real" ? "Host PM2 Active" : "Mock PM2 Engine (Jitter Active)"}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Real-time monitoring and lifecycle process controls
              {lastUpdated && ` • Last refreshed ${new Date(lastUpdated).toLocaleTimeString()}`}
            </p>
          </div>
        </div>

        {/* Polling Countdown & Refresh Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-mono text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
            <Clock className="w-3.5 h-3.5 text-zinc-400 animate-spin-slow" />
            <span>Poll:</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {countdown}s
            </span>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh PM2 metrics now"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh Now</span>
          </button>
        </div>
      </div>

      {/* Status Notifications */}
      {statusMessage && (
        <div
          className={`p-4 rounded-lg flex items-center justify-between gap-3 text-sm ${
            statusMessage.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              : "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs underline cursor-pointer hover:opacity-75"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium uppercase tracking-wider">Total</span>
            <Layers className="w-4 h-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {summary.total}
          </p>
          <span className="text-[11px] text-zinc-400">Configured instances</span>
        </div>

        <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-medium uppercase tracking-wider">Online</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {summary.online}
          </p>
          <span className="text-[11px] text-zinc-400">Active services</span>
        </div>

        <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium uppercase tracking-wider">Stopped</span>
            <span className="w-2 h-2 rounded-full bg-zinc-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-600 dark:text-zinc-400">
            {summary.stopped}
          </p>
          <span className="text-[11px] text-zinc-400">Dormant services</span>
        </div>

        <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium uppercase tracking-wider">Total Memory</span>
            <Database className="w-4 h-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatBytes(summary.totalMemoryBytes)}
          </p>
          <span className="text-[11px] text-zinc-400">Resident memory</span>
        </div>

        <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium uppercase tracking-wider">Avg CPU</span>
            <Cpu className="w-4 h-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {summary.avgCpuPercent}%
          </p>
          <span className="text-[11px] text-zinc-400">Average load</span>
        </div>
      </div>

      {/* Metrics Chart */}
      {isClient && processes.length > 0 && (
        <div className="p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Resource Utilization by Process
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                CPU % and Memory allocation (updated on 60s cycle)
              </p>
            </div>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(24, 24, 27, 0.95)",
                    border: "1px solid rgba(63, 63, 70, 0.5)",
                    borderRadius: "0.5rem",
                    color: "#fff",
                    fontSize: "0.75rem",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "0.5rem" }} />
                <Bar
                  dataKey="cpu"
                  name="CPU (%)"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
                <Bar
                  dataKey="memoryMB"
                  name="Memory (MB)"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Process Table & Cards */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Active Processes ({processes.length})
            </h3>
          </div>
        </div>

        {processes.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Activity className="w-8 h-8 mx-auto text-zinc-400 mb-2" />
            <p className="text-sm font-medium">No PM2 processes found</p>
            <p className="text-xs text-zinc-400 mt-1">
              Start PM2 processes or wait for the mock engine to load
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">Process</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">PID</th>
                  <th className="py-3 px-3">Ports</th>
                  <th className="py-3 px-3">CPU</th>
                  <th className="py-3 px-3">Memory</th>
                  <th className="py-3 px-3">Uptime</th>
                  <th className="py-3 px-3">Restarts</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                {processes.map((proc) => {
                  const isOnline = proc.status === "online";
                  const isStopped = proc.status === "stopped";
                  const startKey = `${proc.id}-start`;
                  const stopKey = `${proc.id}-stop`;
                  const restartKey = `${proc.id}-restart`;

                  return (
                    <tr
                      key={String(proc.id)}
                      className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Name & ID */}
                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-400">
                            #{proc.id}
                          </span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {proc.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            {proc.mode}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                            isOnline
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                              : isStopped
                              ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700"
                              : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border border-red-300 dark:border-red-800"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isOnline
                                ? "bg-emerald-500 animate-pulse"
                                : isStopped
                                ? "bg-zinc-400"
                                : "bg-red-500"
                            }`}
                          />
                          {proc.status}
                        </span>
                      </td>

                      {/* PID */}
                      <td className="py-3.5 px-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {proc.pid || "—"}
                      </td>

                      {/* Ports */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {proc.ports && proc.ports.length > 0 ? (
                            proc.ports.map((port, idx) => (
                              <span 
                                key={idx} 
                                className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded text-[10px] font-mono"
                              >
                                :{port}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </div>
                      </td>

                      {/* CPU */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 min-w-[3rem]">
                            {proc.cpu.toFixed(1)}%
                          </span>
                          <div className="w-16 bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full ${
                                proc.cpu > 50
                                  ? "bg-red-500"
                                  : proc.cpu > 15
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(0, proc.cpu))}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Memory */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 min-w-[4rem]">
                            {formatBytes(proc.memory)}
                          </span>
                        </div>
                      </td>

                      {/* Uptime */}
                      <td className="py-3.5 px-3 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatUptime(proc.uptime)}
                      </td>

                      {/* Restarts */}
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                          {proc.restarts}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 sm:px-6 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {/* Start button (when stopped or errored) */}
                          {!isOnline && (
                            <button
                              onClick={() => handleAction("start", proc.id)}
                              disabled={actionLoading[startKey]}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                              title={`Start process ${proc.name}`}
                            >
                              <Play
                                className={`w-3 h-3 ${
                                  actionLoading[startKey] ? "animate-spin" : ""
                                }`}
                              />
                              <span>Start</span>
                            </button>
                          )}

                          {/* Stop button (when online) */}
                          {isOnline && (
                            <button
                              onClick={() => handleAction("stop", proc.id)}
                              disabled={actionLoading[stopKey]}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                              title={`Stop process ${proc.name}`}
                            >
                              <Square
                                className={`w-3 h-3 ${
                                  actionLoading[stopKey] ? "animate-spin" : ""
                                }`}
                              />
                              <span>Stop</span>
                            </button>
                          )}

                          {/* Restart button (always available) */}
                          <button
                            onClick={() => handleAction("restart", proc.id)}
                            disabled={actionLoading[restartKey]}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
                            title={`Restart process ${proc.name}`}
                          >
                            <RotateCw
                              className={`w-3 h-3 ${
                                actionLoading[restartKey] ? "animate-spin" : ""
                              }`}
                            />
                            <span>Restart</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
