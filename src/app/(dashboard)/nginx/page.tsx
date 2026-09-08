import NginxEditor from "@/components/NginxEditor";
import { FileCode } from "lucide-react";

export const dynamic = "force-dynamic";

export default function NginxPage() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative">
      <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
      
      <div className="pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <FileCode className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Gateway Configs
            </h1>
            <p className="text-slate-400 text-sm mt-1.5">
              Edit Nginx virtual host configurations directly
            </p>
          </div>
        </div>
      </div>
      
      <NginxEditor />
    </div>
  );
}
