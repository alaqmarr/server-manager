import { auth } from "@/auth";
import Link from "next/link";
import { 
  Activity, 
  Network, 
  FileCode, 
  Terminal,
  Cpu,
  Database,
  Globe,
  ShieldAlert
} from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="p-8 w-full space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      {/* Header */}
      <div className="relative pb-6 border-b border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 rounded-full blur-[100px] -z-10" />
        <h1 className="text-4xl font-extrabold text-white tracking-tight text-glow">
          Welcome back, {session?.user?.name || "Admin"}
        </h1>
        <p className="text-slate-400 mt-2 text-lg">
          Your server infrastructure is online and functioning nominally.
        </p>
      </div>

      {/* Quick Stats Mini */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "System Load", value: "2.4%", icon: Cpu, color: "text-brand-400" },
          { label: "Memory Usage", value: "4.1 GB", icon: Database, color: "text-blue-400" },
          { label: "Active Connections", value: "128", icon: Globe, color: "text-emerald-400" },
          { label: "Security Threats", value: "0", icon: ShieldAlert, color: "text-slate-500" },
        ].map((stat, i) => (
          <div key={i} className="card-gradient rounded-2xl p-5 flex items-center gap-4 group hover:border-white/10 transition-colors">
            <div className={`p-3 bg-surface-950/50 rounded-xl border border-white/5 ${stat.color} group-hover:scale-110 transition-transform`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{stat.label}</p>
              <p className="text-xl font-bold text-slate-200 mt-0.5">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-4">
        <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Quick Launch</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <Link href="/pm2" className="group card-gradient rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(45,212,191,0.1)] hover:border-brand-500/30">
            <div className="w-12 h-12 bg-brand-500/10 border border-brand-500/20 rounded-xl flex items-center justify-center text-brand-400 mb-4 group-hover:bg-brand-500 group-hover:text-surface-950 transition-colors">
              <Activity className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Process Engine</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Monitor CPU/Memory metrics and orchestrate your PM2 microservices.
            </p>
          </Link>

          <Link href="/ports" className="group card-gradient rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(59,130,246,0.1)] hover:border-blue-500/30">
            <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center text-blue-400 mb-4 group-hover:bg-blue-500 group-hover:text-surface-950 transition-colors">
              <Network className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Network Matrix</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Discover listening sockets and active protocol mappings across the host.
            </p>
          </Link>

          <Link href="/nginx" className="group card-gradient rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(168,85,247,0.1)] hover:border-purple-500/30">
            <div className="w-12 h-12 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-center text-purple-400 mb-4 group-hover:bg-purple-500 group-hover:text-surface-950 transition-colors">
              <FileCode className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Gateway Configs</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Safely view and edit reverse proxy logic and Nginx virtual hosts.
            </p>
          </Link>

          <Link href="/terminal" className="group card-gradient rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(236,72,153,0.1)] hover:border-pink-500/30">
            <div className="w-12 h-12 bg-pink-500/10 border border-pink-500/20 rounded-xl flex items-center justify-center text-pink-400 mb-4 group-hover:bg-pink-500 group-hover:text-surface-950 transition-colors">
              <Terminal className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Root Terminal</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Execute raw shell commands securely directly from the browser window.
            </p>
          </Link>

        </div>
      </div>
    </div>
  );
}
