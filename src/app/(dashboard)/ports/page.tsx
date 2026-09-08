import PortManager from "@/components/PortManager";
import { Network } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PortsPage() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pb-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Network className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Active Network Ports
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Discover which applications are listening on which ports
            </p>
          </div>
        </div>
      </div>
      
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <PortManager />
      </div>
    </div>
  );
}
