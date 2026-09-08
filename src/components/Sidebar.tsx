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
  Server
} from "lucide-react";

export function Sidebar({ userName }: { userName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const navItems = [
    { name: "Overview", href: "/", icon: LayoutDashboard },
    { name: "PM2 Manager", href: "/pm2", icon: Activity },
    { name: "Port Discovery", href: "/ports", icon: Network },
    { name: "Nginx Configs", href: "/nginx", icon: FileCode },
    { name: "Web Terminal", href: "/terminal", icon: Terminal },
  ];

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between bg-zinc-900 text-white p-4 sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Server className="w-5 h-5 text-emerald-500" />
          Server Manager
        </div>
        <button onClick={toggleSidebar} className="text-zinc-300 hover:text-white transition">
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar Content */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-zinc-900 text-zinc-300 transform transition-transform duration-300 ease-in-out flex flex-col
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0 md:static md:w-64 md:flex-shrink-0
      `}>
        <div className="hidden md:flex items-center gap-3 font-bold text-xl p-6 text-white border-b border-zinc-800">
          <Server className="w-6 h-6 text-emerald-500" />
          Server Manager
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={closeSidebar}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${isActive 
                      ? "bg-emerald-500/10 text-emerald-400" 
                      : "hover:bg-zinc-800 hover:text-white"}
                  `}
                >
                  <Icon className={`w-5 h-5 ${isActive ? "text-emerald-400" : "text-zinc-400"}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User profile & Logout */}
        <div className="p-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center gap-3 px-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 truncate text-sm">
              <p className="text-white font-medium truncate">{userName}</p>
              <p className="text-zinc-500 text-xs">Admin</p>
            </div>
          </div>
          
          <form action="/api/auth/signout" method="POST" className="px-1">
            <button
              type="submit"
              className="flex w-full items-center gap-3 px-2 py-2 text-sm font-medium text-zinc-400 hover:text-white hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
