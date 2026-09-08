import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import PM2Manager from "@/components/PM2Manager";
import PortManager from "@/components/PortManager";
import NginxEditor from "@/components/NginxEditor";
import WebTerminal from "@/components/WebTerminal";
import { Activity, Network, FileCode, Terminal } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            PM2 Management Dashboard
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Server process monitoring, network ports, Nginx configuration, and terminal console
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
            Admin: {session.user.name || "admin"}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {/* Metric Cards / Quick Jump Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <a
          href="#pm2"
          className="p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-emerald-500/50 hover:shadow-md transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              PM2 Processes
            </h2>
            <Activity className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            Active
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Milestone M2 • Process controller & metrics
          </p>
        </a>

        <a
          href="#ports"
          className="p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-blue-500/50 hover:shadow-md transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Active Ports
            </h2>
            <Network className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
            Listening
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Milestone M3 • Network socket discovery
          </p>
        </a>

        <a
          href="#nginx"
          className="p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-emerald-500/50 hover:shadow-md transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Nginx Configs
            </h2>
            <FileCode className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Editable
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Milestone M3 • Virtual host configuration editor
          </p>
        </a>

        <a
          href="#terminal"
          className="p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-purple-500/50 hover:shadow-md transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Web Terminal
            </h2>
            <Terminal className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="mt-2 text-2xl font-bold text-purple-600 dark:text-purple-400">
            Interactive
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Milestone M4 • Shell execution console
          </p>
        </a>
      </div>

      {/* Section 1: PM2 Management & Monitoring (M2) */}
      <section id="pm2" className="scroll-mt-8 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <Activity className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            PM2 Process Controller & Telemetry
          </h2>
        </div>
        <PM2Manager />
      </section>

      {/* Section 2: Active Port Discovery (M3) */}
      <section id="ports" className="scroll-mt-8 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <Network className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Active Network Port Mappings
          </h2>
        </div>
        <PortManager />
      </section>

      {/* Section 3: Nginx Configuration Editor (M3) */}
      <section id="nginx" className="scroll-mt-8 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <FileCode className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Nginx Gateway & Virtual Host Configuration
          </h2>
        </div>
        <NginxEditor />
      </section>

      {/* Section 4: Web Terminal Console (M4) */}
      <section id="terminal" className="scroll-mt-8 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <Terminal className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Interactive Web Terminal Console
          </h2>
        </div>
        <WebTerminal username="user" />
      </section>
    </div>
  );
}
