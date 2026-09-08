import WebTerminal from "@/components/WebTerminal";
import { Terminal } from "lucide-react";

export const dynamic = "force-dynamic";

export default function TerminalPage() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative">
      <div className="absolute top-0 left-0 w-96 h-96 bg-pink-500/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
      
      <div className="pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-pink-500/10 rounded-xl border border-pink-500/20 shadow-[0_0_15px_rgba(236,72,153,0.15)]">
            <Terminal className="w-6 h-6 text-pink-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Root Terminal
            </h1>
            <p className="text-slate-400 text-sm mt-1.5">
              Secure shell access to execute host commands
            </p>
          </div>
        </div>
      </div>
      
      <WebTerminal />
    </div>
  );
}
