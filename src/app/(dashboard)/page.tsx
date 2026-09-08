import { Activity, Network, FileCode, Terminal } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return (
    <div className="p-8 w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          Overview
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Server health and quick access to management tools.
        </p>
      </div>

      {/* Metric Cards / Quick Jump Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-6">
        <Link
          href="/pm2"
          className="p-6 bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 shadow-sm hover:border-emerald-500/50 hover:shadow-md hover:bg-zinc-900 transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
              PM2 Processes
            </h2>
            <div className="p-2 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
              <Activity className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            Manager
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Process controller & resource metrics
          </p>
        </Link>

        <Link
          href="/ports"
          className="p-6 bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 shadow-sm hover:border-blue-500/50 hover:shadow-md hover:bg-zinc-900 transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
              Active Ports
            </h2>
            <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
              <Network className="w-5 h-5 text-blue-500" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            Discovery
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Network socket and listener mapping
          </p>
        </Link>

        <Link
          href="/nginx"
          className="p-6 bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 shadow-sm hover:border-emerald-500/50 hover:shadow-md hover:bg-zinc-900 transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
              Nginx Configs
            </h2>
            <div className="p-2 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
              <FileCode className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            Editor
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Virtual host configuration editor
          </p>
        </Link>

        <Link
          href="/terminal"
          className="p-6 bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 shadow-sm hover:border-purple-500/50 hover:shadow-md hover:bg-zinc-900 transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
              Web Terminal
            </h2>
            <div className="p-2 bg-purple-500/10 rounded-lg group-hover:bg-purple-500/20 transition-colors">
              <Terminal className="w-5 h-5 text-purple-500" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            Console
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Interactive shell execution
          </p>
        </Link>
      </div>
      
      {/* Welcome / System Info Widget */}
      <div className="p-8 bg-zinc-900 rounded-2xl border border-zinc-800">
        <h2 className="text-xl font-bold text-white mb-4">Welcome to Server Manager</h2>
        <p className="text-zinc-400 max-w-2xl leading-relaxed">
          Use the sidebar to navigate between your PM2 processes, active ports, Nginx configurations, and the web terminal. 
          This dashboard runs directly on your server, providing secure access to critical infrastructure management tools.
        </p>
      </div>
    </div>
  );
}
