import PM2Manager from "@/components/PM2Manager";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PM2Page() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pb-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Activity className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              PM2 Process Manager
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitor process metrics and control your PM2 applications
            </p>
          </div>
        </div>
      </div>
      
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <PM2Manager />
      </div>
    </div>
  );
}
