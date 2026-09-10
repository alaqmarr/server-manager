"use client";
import { useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, Server, Zap, MemoryStick, Clock } from "lucide-react";

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);

  const fallbackStats = {
    hostname: "localhost",
    platform: "linux",
    release: "server",
    uptime: 0,
    cpu: { load: [0, 0, 0], model: "System CPU" },
    memory: { used: 0, total: 1, usagePercent: 0 },
    disk: { used: 0, total: 1, usagePercent: 0 },
  };

  const loadStats = async () => {
    try {
      const res = await fetch("/api/system/stats");
      if (!res.ok) {
        setStats((prev: any) => prev || fallbackStats);
        return;
      }
      const data = await res.json();
      if (data && data.cpu && data.memory) {
        setStats(data);
      } else {
        setStats((prev: any) => prev || fallbackStats);
      }
    } catch {
      setStats((prev: any) => prev || fallbackStats);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <div className="p-8 flex items-center justify-center animate-pulse"><Zap className="w-8 h-8 text-brand-500" /></div>;

  const memPercent = stats.memory?.usagePercent?.toFixed(1) || "0.0";
  const memUsedGB = ((stats.memory?.used || 0) / 1024 / 1024 / 1024).toFixed(2);
  const memTotalGB = ((stats.memory?.total || 1) / 1024 / 1024 / 1024).toFixed(2);
  
  const diskPercent = stats.disk?.usagePercent?.toFixed(1) || "0.0";
  const diskUsedGB = ((stats.disk?.used || 0) / 1024 / 1024 / 1024).toFixed(2);
  const diskTotalGB = ((stats.disk?.total || 1) / 1024 / 1024 / 1024).toFixed(2);

  const uptimeHours = ((stats.uptime || 0) / 3600).toFixed(1);

  return (
    <div className="p-4 md:p-8 w-full space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="relative pb-6 border-b border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 rounded-full blur-[100px] -z-10" />
        <h1 className="text-4xl font-extrabold text-white tracking-tight text-glow">
          System <span className="text-brand-400">Dashboard</span>
        </h1>
        <p className="text-surface-400 mt-2 text-sm max-w-xl">
          Real-time metrics for {stats.hostname} ({stats.platform} {stats.release})
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-brand-500/10 rounded-full blur-2xl group-hover:bg-brand-500/20 transition-all duration-500"/>
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-brand-500/10 rounded-xl">
              <Cpu className="w-6 h-6 text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-surface-400">CPU Load (1m)</p>
              <h3 className="text-2xl font-bold text-white">{(stats.cpu?.load?.[0] ?? 0).toFixed(2)}</h3>
            </div>
          </div>
          <div className="text-xs text-surface-500 truncate" title={stats.cpu?.model || "CPU"}>{stats.cpu?.model || "CPU"}</div>
        </div>

        <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all duration-500"/>
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-purple-500/10 rounded-xl">
              <MemoryStick className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-surface-400">RAM Usage</p>
              <h3 className="text-2xl font-bold text-white">{memPercent}%</h3>
            </div>
          </div>
          <div className="w-full bg-surface-900 rounded-full h-1.5 mb-2 overflow-hidden">
            <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${memPercent}%` }}></div>
          </div>
          <p className="text-xs text-surface-500">{memUsedGB} GB / {memTotalGB} GB</p>
        </div>

        <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all duration-500"/>
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-blue-500/10 rounded-xl">
              <HardDrive className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-surface-400">Disk Space</p>
              <h3 className="text-2xl font-bold text-white">{diskPercent}%</h3>
            </div>
          </div>
          <div className="w-full bg-surface-900 rounded-full h-1.5 mb-2 overflow-hidden">
            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${diskPercent}%` }}></div>
          </div>
          <p className="text-xs text-surface-500">{diskUsedGB} GB / {diskTotalGB} GB</p>
        </div>

        <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all duration-500"/>
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-500/10 rounded-xl">
              <Clock className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-surface-400">System Uptime</p>
              <h3 className="text-2xl font-bold text-white">{uptimeHours}h</h3>
            </div>
          </div>
          <p className="text-xs text-surface-500">Running smoothly</p>
        </div>
      </div>
    </div>
  );
}
