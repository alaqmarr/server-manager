import PM2Manager from "@/components/PM2Manager";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PM2Page() {
  return (
    <div className="p-6 max-w-7xl mx-auto w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Activity className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              PM2 Process Manager
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
              Monitor process metrics and control your PM2 applications
            </p>
          </div>
        </div>
      </div>
      
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden">
        <PM2Manager />
      </div>
    </div>
  );
}
