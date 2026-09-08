"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Server,
  Activity,
  RotateCw,
  Square,
  Play,
  RefreshCw,
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
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  mode: string;
  pid?: number;
  ports?: number[];
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatUptime(uptimeMs: number) {
  if (uptimeMs === 0) return "0s";
  const seconds = Math.floor((uptimeMs / 1000) % 60);
  const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
  const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || seconds > 0) parts.push(`${seconds}s`);

  return parts.slice(0, 2).join(" ");
}

export default function PM2Manager() {
  const [processes, setProcesses] = useState<PM2Process[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchProcesses = async () => {
    try {
      const res = await fetch("/api/pm2");
      if (!res.ok) {
        throw new Error(`Failed to fetch processes: ${res.statusText}`);
      }
      const data = await res.json();
      setProcesses(data.processes || []);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred");
    }
  };

  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    await fetchProcesses();
    setIsLoading(false);
    if (isManualRefresh) setIsRefreshing(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      fetchProcesses();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const handleAction = async (action: "start" | "stop" | "restart", id: number | string) => {
    const actionKey = `${id}-${action}`;
    setActionLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      const res = await fetch("/api/pm2/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (!res.ok) {
        throw new Error(`Failed to ${action} process ${id}`);
      }
      await fetchProcesses();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading((prev) => ({ ...prev, [actionKey]: false }));
    }
  };

  const summary = useMemo(() => {
    const total = processes.length;
    let online = 0;
    let stopped = 0;
    let totalMemoryBytes = 0;
    let totalCpu = 0;

    processes.forEach((p) => {
      if (p.status === "online") online++;
      if (p.status === "stopped") stopped++;
      totalMemoryBytes += p.memory;
      totalCpu += p.cpu;
    });

    return {
      total,
      online,
      stopped,
      totalMemoryBytes,
      avgCpuPercent: total > 0 ? (totalCpu / total).toFixed(1) : "0.0",
    };
  }, [processes]);

  const chartData = useMemo(() => {
    return processes.map((p) => ({
      name: p.name,
      cpu: p.cpu,
      memoryMB: Math.round(p.memory / (1024 * 1024)),
    }));
  }, [processes]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Activity className="w-10 h-10 animate-pulse mb-4 opacity-50" />
        <p className="font-medium tracking-wide">Connecting to PM2 Daemon...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center justify-between">
          <p>{error}</p>
        </div>
      )}

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 card-gradient p-4 rounded-2xl">
        <div>
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            System Resources
          </h2>
          {lastRefreshed && (
            <p className="text-xs text-slate-400 mt-1">
              Last updated: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/50 text-brand-400 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Force Sync
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {[
          { label: "Total", value: summary.total, icon: Layers, color: "text-blue-400" },
          { label: "Online", value: summary.online, icon: Activity, color: "text-brand-400" },
          { label: "Stopped", value: summary.stopped, icon: Square, color: "text-slate-500" },
          { label: "Total RAM", value: formatBytes(summary.totalMemoryBytes), icon: Database, color: "text-purple-400" },
          { label: "Avg CPU", value: summary.avgCpuPercent + "%", icon: Cpu, color: "text-pink-400" },
        ].map((stat, i) => (
          <div key={i} className="card-gradient rounded-2xl p-5 border border-white/5 relative overflow-hidden group">
            <div className="flex items-center justify-between z-10 relative">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{stat.label}</span>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <div className={`mt-3 text-2xl font-black ${stat.color} drop-shadow-sm`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Visualizer */}
      {processes.length > 0 && (
        <div className="card-gradient rounded-2xl p-6 border border-white/5 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}
                itemStyle={{ color: '#e2e8f0', fontSize: '12px' }}
                labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
              <Bar yAxisId="left" dataKey="cpu" name="CPU (%)" fill="#2dd4bf" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar yAxisId="right" dataKey="memoryMB" name="Memory (MB)" fill="#818cf8" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Main Data Table */}
      <div className="card-gradient rounded-2xl border border-white/5 overflow-hidden">
        <div className="p-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-brand-400" />
            <h3 className="text-white font-bold">Live Processes</h3>
          </div>
        </div>

        {processes.length === 0 ? (
          <div className="p-16 text-center">
            <Server className="w-12 h-12 mx-auto text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium">No PM2 instances found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-surface-900/50 text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="py-4 px-6 font-semibold">Instance</th>
                  <th className="py-4 px-4 font-semibold">Status</th>
                  <th className="py-4 px-4 font-semibold">CPU</th>
                  <th className="py-4 px-4 font-semibold">RAM</th>
                  <th className="py-4 px-4 font-semibold">Uptime</th>
                  <th className="py-4 px-4 font-semibold">Ports</th>
                  <th className="py-4 px-6 text-right font-semibold">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {processes.map((proc) => {
                  const isOnline = proc.status === "online";
                  const startKey = `${proc.id}-start`;
                  const stopKey = `${proc.id}-stop`;
                  const restartKey = `${proc.id}-restart`;

                  return (
                    <tr key={String(proc.id)} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] text-slate-500 w-4 block text-center">#{proc.id}</span>
                          <span className="font-bold text-slate-200">{proc.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-white/5 text-slate-400 border border-white/10">
                            {proc.mode}
                          </span>
                        </div>
                      </td>
                      
                      <td className="py-4 px-4">
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isOnline ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-brand-500 animate-pulse' : 'bg-slate-500'}`} />
                          {proc.status}
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-slate-300 w-10">{proc.cpu.toFixed(1)}%</span>
                          <div className="w-16 bg-surface-950 rounded-full h-1.5 border border-white/5">
                            <div
                              className={`h-full rounded-full ${proc.cpu > 50 ? "bg-red-500" : proc.cpu > 15 ? "bg-yellow-500" : "bg-brand-500"}`}
                              style={{ width: `${Math.min(100, Math.max(0, proc.cpu))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4 font-mono text-xs text-slate-300">
                        {formatBytes(proc.memory)}
                      </td>

                      <td className="py-4 px-4 font-mono text-xs text-slate-400">
                        {formatUptime(proc.uptime)}
                      </td>

                      <td className="py-4 px-4">
                        <div className="flex flex-wrap gap-1">
                          {proc.ports?.length ? (
                            proc.ports.map((p, idx) => (
                              <span key={idx} className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[10px] font-mono">
                                :{p}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-6">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                          {!isOnline ? (
                            <button
                              onClick={() => handleAction("start", proc.id)}
                              disabled={actionLoading[startKey]}
                              className="w-8 h-8 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 flex items-center justify-center transition-colors disabled:opacity-50"
                              title="Start"
                            >
                              <Play className={`w-4 h-4 ${actionLoading[startKey] ? "animate-spin" : ""}`} />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction("stop", proc.id)}
                              disabled={actionLoading[stopKey]}
                              className="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition-colors disabled:opacity-50"
                              title="Stop"
                            >
                              <Square className={`w-4 h-4 ${actionLoading[stopKey] ? "animate-spin" : ""}`} />
                            </button>
                          )}
                          <button
                            onClick={() => handleAction("restart", proc.id)}
                            disabled={actionLoading[restartKey]}
                            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors disabled:opacity-50"
                            title="Restart"
                          >
                            <RotateCw className={`w-4 h-4 ${actionLoading[restartKey] ? "animate-spin" : ""}`} />
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
