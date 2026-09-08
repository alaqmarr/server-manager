"use client";

import { useEffect, useState } from "react";
import { Network, RefreshCw, AlertCircle, Server } from "lucide-react";

interface PortInfo {
  port: number;
  protocol: string;
  processName: string;
  pid: number;
}

export default function PortManager() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPorts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ports");
      if (!res.ok) throw new Error("Failed to fetch port mappings");
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();
      setPorts(data.ports || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPorts();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between card-gradient p-4 rounded-2xl">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" />
          Active Sockets
        </h2>
        <button
          onClick={fetchPorts}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Scan Now
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5" />
          <p>{error}</p>
        </div>
      )}

      <div className="card-gradient rounded-2xl border border-white/5 overflow-hidden">
        {loading && ports.length === 0 ? (
          <div className="p-16 flex flex-col items-center text-slate-500">
            <Network className="w-12 h-12 mb-4 opacity-50 animate-pulse" />
            <p>Scanning network interfaces...</p>
          </div>
        ) : ports.length === 0 ? (
          <div className="p-16 flex flex-col items-center text-slate-500">
            <Server className="w-12 h-12 mb-4 opacity-50" />
            <p>No active listening ports found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-surface-900/50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5">
                  <th className="py-4 px-6 font-semibold">Port</th>
                  <th className="py-4 px-4 font-semibold">Protocol</th>
                  <th className="py-4 px-4 font-semibold">Process Name</th>
                  <th className="py-4 px-6 font-semibold">PID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ports.map((p, idx) => (
                  <tr key={`${p.port}-${idx}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                        <span className="font-mono font-bold text-blue-100">{p.port}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-white/5 text-slate-400 border border-white/10">
                        {p.protocol}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-semibold text-slate-200">{p.processName || "Unknown"}</span>
                    </td>
                    <td className="py-4 px-6">
                      <span className="font-mono text-xs text-slate-500">
                        {p.pid || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
