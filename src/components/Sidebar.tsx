"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Activity, 
  Network, 
  FileCode, 
  Terminal, 
  Menu,
  X,
  LogOut,
  Hexagon,
  FolderOpen,
  Globe,
  Server,
  Clock,
  FileText,
  Shield,
  FileKey,
  Database
} from "lucide-react";

export function Sidebar({ userName }: { userName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const navItems = [
  { name: "Dashboard", href: "/", icon: Activity },
  { name: "File Explorer", href: "/files", icon: FolderOpen },
  { name: "Nginx Manager", href: "/nginx", icon: Globe },
  { name: "PM2 Manager", href: "/pm2", icon: Server },
  { name: "Port Mappings", href: "/ports", icon: Network },
    { name: "Task Runner", href: "/scripts", icon: FileCode },
  { name: "Cron Jobs", href: "/cron", icon: Clock },
  { name: "Firewall", href: "/firewall", icon: Shield },
  { name: "Environment Vars", href: "/env", icon: FileKey },
  { name: "Database GUI", href: "/database", icon: Database },
  { name: "System Logs", href: "/logs", icon: FileText },
  { name: "Web Terminal", href: "/terminal", icon: Terminal },
];

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between bg-surface-900 border-b border-white/5 p-4 sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-lg text-white">
          <Hexagon className="w-5 h-5 text-brand-400" />
          Nexus
        </div>
        <button onClick={() => setIsOpen(!isOpen)} className="text-slate-400 hover:text-white transition">
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 glass-panel flex flex-col transform transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0 md:static md:w-64 md:m-4 md:rounded-2xl md:h-[calc(100vh-2rem)]
      `}>
        {/* Brand */}
        <div className="flex items-center gap-3 font-bold text-xl px-6 pt-8 pb-6 text-white tracking-wide">
          <div className="p-2 bg-brand-500/10 rounded-xl border border-brand-500/20 shadow-[0_0_15px_rgba(45,212,191,0.15)]">
            <Hexagon className="w-5 h-5 text-brand-400" />
          </div>
          NEXUS
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          <div className="px-3 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Core Modules
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`
                    group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                    ${isActive 
                      ? "bg-brand-500/10 text-brand-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-brand-500/20" 
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"}
                  `}
                >
                  <Icon className={`w-[18px] h-[18px] transition-transform duration-200 ${isActive ? "scale-110" : "group-hover:scale-110"}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Profile */}
        <div className="p-4 m-3 mt-auto bg-surface-950/50 rounded-xl border border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-lg">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 truncate">
              <p className="text-sm text-slate-200 font-medium truncate">{userName}</p>
              <p className="text-xs text-brand-400/80">System Admin</p>
            </div>
          </div>
          
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-400 bg-white/5 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors border border-white/5 hover:border-red-500/20"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
