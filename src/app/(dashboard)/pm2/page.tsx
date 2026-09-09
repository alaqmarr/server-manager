import PM2Manager from "@/components/PM2Manager";
import VitalsChart from "@/components/VitalsChart";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PM2Page() {
  return (
    <div className="p-4 md:p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative">
      <div className="absolute top-0 left-0 w-96 h-96 bg-brand-500/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
      
      <div className="pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-brand-500/10 rounded-xl border border-brand-500/20 shadow-[0_0_15px_rgba(45,212,191,0.15)]">
            <Activity className="w-6 h-6 text-brand-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Process Engine
            </h1>
            <p className="text-slate-400 text-sm mt-1.5">
              Monitor process metrics and control your PM2 applications
            </p>
          </div>
        </div>
      </div>
      
      <PM2Manager />

      <div className="pt-6 border-t border-white/5">
        <VitalsChart />
      </div>
    </div>
  );
}
