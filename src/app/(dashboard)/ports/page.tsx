import PortManager from "@/components/PortManager";
import { Network } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PortsPage() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative">
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
      
      <div className="pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
            <Network className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Network Matrix
            </h1>
            <p className="text-slate-400 text-sm mt-1.5">
              Discover which applications are listening on which ports
            </p>
          </div>
        </div>
      </div>
      
      <PortManager />
    </div>
  );
}
