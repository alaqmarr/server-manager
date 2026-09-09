import UptimeDashboard from "@/components/UptimeDashboard";
import { Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default function UptimePage() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative">
      <div className="absolute top-0 left-0 w-96 h-96 bg-brand-500/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
      
      <div className="pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-brand-500/10 rounded-xl border border-brand-500/20 shadow-[0_0_15px_rgba(45,212,191,0.15)]">
            <Clock className="w-6 h-6 text-brand-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Uptime Monitor
            </h1>
            <p className="text-slate-400 text-sm mt-1.5">
              Continuous endpoint health checks, response time monitoring, and SLA tracking
            </p>
          </div>
        </div>
      </div>

      <UptimeDashboard />
    </div>
  );
}
