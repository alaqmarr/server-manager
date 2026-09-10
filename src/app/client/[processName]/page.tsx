"use client";

import { useEffect, useState, use } from "react";
import { Activity, Cpu, Server, RotateCw, Terminal, LogOut } from "lucide-react";
import LogStreamer from "@/components/LogStreamer";
import { VitalsChart } from "@/components/VitalsChart";
import { signOut } from "next-auth/react";

export default function ClientDashboard(props: { params: Promise<{ processName: string }> }) {
  const params = use(props.params);
  const processName = params.processName;
  
  const [process, setProcess] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/pm2");
        if (res.ok) {
          const data = await res.json();
          const myProcess = data.processes?.find((p: any) => p.name === processName);
          setProcess(myProcess || null);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    const int = setInterval(fetchData, 5000);
    return () => clearInterval(int);
  }, [processName]);

  const handleRestart = async () => {
    if (!confirm(`Are you sure you want to restart ${processName}?`)) return;
    setIsRestarting(true);
    try {
      await fetch("/api/pm2/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart", id: processName }),
      });
    } finally {
      setTimeout(() => setIsRestarting(false), 2000);
    }
  };

  const isOnline = process?.status === "online";

  return (
    <div className="min-h-screen bg-surface-950 text-slate-300 font-sans p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-brand-500/10 rounded-xl border border-brand-500/20">
            <Server className="w-6 h-6 text-brand-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              {processName}
            </h1>
            <p className="text-sm text-slate-400">Client Dashboard</p>
          </div>
        </div>
        
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2 px-4 py-2 bg-surface-900 hover:bg-surface-800 text-slate-300 rounded-lg border border-white/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center animate-pulse">
          <Activity className="w-8 h-8 text-brand-500" />
        </div>
      ) : !process ? (
        <div className="p-8 bg-red-500/10 border border-red-500/20 rounded-xl text-center text-red-400">
          We could not find the application "{processName}". It may be offline or you may not have permission to view it.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="col-span-1 space-y-6">
              <div className="p-6 bg-surface-900 rounded-xl border border-white/5 shadow-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Status</h3>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                    {process.status.toUpperCase()}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-surface-950 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm">
                      <Cpu className="w-4 h-4" /> CPU
                    </div>
                    <div className="text-xl font-mono text-white">{process.cpu}%</div>
                  </div>
                  <div className="p-4 bg-surface-950 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm">
                      <Activity className="w-4 h-4" /> Memory
                    </div>
                    <div className="text-xl font-mono text-white">{(process.memory / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <button
                    onClick={handleRestart}
                    disabled={isRestarting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg transition-all"
                  >
                    <RotateCw className={`w-5 h-5 ${isRestarting ? 'animate-spin' : ''}`} />
                    {isRestarting ? 'Restarting...' : 'Restart Application'}
                  </button>
                </div>
              </div>
            </div>

            <div className="col-span-1 md:col-span-2">
              <div className="h-[600px] flex flex-col bg-surface-900 rounded-xl border border-white/5 shadow-lg overflow-hidden">
                <div className="flex items-center gap-2 p-4 border-b border-white/5 bg-surface-900/50">
                  <Terminal className="w-5 h-5 text-slate-400" />
                  <h3 className="font-semibold text-white">Live Logs</h3>
                </div>
                <div className="flex-1 overflow-hidden p-2">
                  <LogStreamer processes={[process]} initialProcess={processName} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <VitalsChart />
          </div>
        </div>
      )}
    </div>
  );
}
