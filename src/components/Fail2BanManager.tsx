"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Unlock,
  Lock,
  AlertCircle,
  CheckCircle2,
  Filter,
  Search,
  Server,
  Layers,
} from "lucide-react";

export interface BannedIPItem {
  ip: string;
  jail: string;
  banTime?: string;
  bannedAt?: string;
}

export interface Fail2BanManagerProps {
  userRole?: "admin" | "developer" | string;
  initialJails?: string[];
  initialBannedList?: BannedIPItem[];
}

export function Fail2BanManager({
  userRole,
  initialJails,
  initialBannedList,
}: Fail2BanManagerProps) {
  const [jails, setJails] = useState<string[]>(initialJails || []);
  const [bannedList, setBannedList] = useState<BannedIPItem[]>(
    initialBannedList || []
  );
  const [mode, setMode] = useState<"real" | "mock">("mock");
  const [loading, setLoading] = useState(false);
  const [unbanningTarget, setUnbanningTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedJail, setSelectedJail] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [detectedRole, setDetectedRole] = useState<string>(userRole || "");

  // Determine if current user has admin rights
  const effectiveRole = userRole || detectedRole;
  const isAdmin = effectiveRole.toLowerCase() === "admin";

  // Check user session if role is not supplied via props
  useEffect(() => {
    if (!userRole) {
      fetch("/api/auth/session")
        .then((res) => (res.ok ? res.json() : null))
        .then((session) => {
          if (session?.user?.role) {
            setDetectedRole(session.user.role);
          }
        })
        .catch(() => {});
    }
  }, [userRole]);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fail2ban");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setJails(Array.isArray(data.jails) ? data.jails : []);
        setBannedList(Array.isArray(data.bannedList) ? data.bannedList : []);
        if (data.mode) setMode(data.mode);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load Fail2Ban status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleUnban = async (jail: string, ip: string) => {
    if (!isAdmin) {
      setError("Admin privileges required to unban IPs.");
      return;
    }

    setUnbanningTarget(`${jail}:${ip}`);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/fail2ban/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jail, ip }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSuccessMessage(data.message || `IP ${ip} unbanned from jail ${jail}`);
      // Optimistically remove from list immediately
      setBannedList((prev) =>
        prev.filter((item) => !(item.ip === ip && item.jail === jail))
      );
      // Refresh status in background
      fetchStatus();
    } catch (err: any) {
      setError(err.message || "Failed to unban IP");
    } finally {
      setUnbanningTarget(null);
    }
  };

  // Filtered banned IPs
  const filteredBanned = bannedList.filter((item) => {
    const matchesJail =
      selectedJail === "all" ||
      item.jail.toLowerCase() === selectedJail.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      item.ip.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.jail.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesJail && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 card-gradient p-5 rounded-2xl border border-white/5 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
            <Shield className="w-6 h-6 text-red-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-white tracking-tight">
                Fail2Ban Security Shield
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono uppercase tracking-wider font-semibold border ${
                  mode === "real"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                }`}
              >
                {mode === "real" ? "Host CLI Mode" : "Emulated Shield"}
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-1">
              Active brute force monitoring, jail status, and IP unban controls
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status Alerts */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between text-red-400 text-sm">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400/80 hover:text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between text-emerald-400 text-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p>{successMessage}</p>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-xs text-emerald-400/80 hover:text-emerald-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Jails Badge Summary Cards */}
      <div className="card-gradient p-5 rounded-2xl border border-white/5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Layers className="w-4 h-4 text-brand-400" />
            Active Jails Summary
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {jails.length} {jails.length === 1 ? "jail" : "jails"} configured
          </span>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => setSelectedJail("all")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              selectedJail === "all"
                ? "bg-brand-500/20 text-brand-300 border-brand-500/40 shadow-[0_0_10px_rgba(45,212,191,0.15)]"
                : "bg-white/5 text-slate-400 hover:bg-white/10 border-white/10 hover:text-slate-200"
            }`}
          >
            <Filter className="w-3 h-3" />
            All Jails ({bannedList.length})
          </button>

          {jails.map((jailName) => {
            const count = bannedList.filter(
              (b) => b.jail.toLowerCase() === jailName.toLowerCase()
            ).length;
            const isSelected =
              selectedJail.toLowerCase() === jailName.toLowerCase();
            return (
              <button
                key={jailName}
                onClick={() => setSelectedJail(isSelected ? "all" : jailName)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                  isSelected
                    ? "bg-brand-500/20 text-brand-300 border-brand-500/40 shadow-[0_0_10px_rgba(45,212,191,0.15)]"
                    : "bg-white/5 text-slate-300 hover:bg-white/10 border-white/10 hover:text-white"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    count > 0 ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                />
                <span className="font-mono">{jailName}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono ${
                    count > 0
                      ? "bg-red-500/20 text-red-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {count} banned
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Banned IPs Table */}
      <div className="card-gradient rounded-2xl border border-white/5 overflow-hidden shadow-2xl space-y-0">
        {/* Table Filter Bar */}
        <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-950/40">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-white">
              Banned Threat IPs ({filteredBanned.length})
            </h3>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search by IP or jail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-surface-900/60 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500/50 w-full sm:w-56"
            />
          </div>
        </div>

        {/* Table Content */}
        {loading && bannedList.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-slate-500">
            <RefreshCw className="w-8 h-8 mb-3 opacity-50 animate-spin text-brand-400" />
            <p className="text-sm">Querying Fail2Ban jail states...</p>
          </div>
        ) : filteredBanned.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-slate-500">
            <ShieldCheck className="w-10 h-10 mb-3 text-emerald-400/60" />
            <p className="text-sm font-medium text-slate-300">
              No banned IPs found
            </p>
            <p className="text-xs text-slate-500 mt-1">
              All monitored services are clear of active bans.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-surface-900/50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5">
                  <th className="py-3.5 px-6 font-semibold">IP Address</th>
                  <th className="py-3.5 px-4 font-semibold">Jail</th>
                  <th className="py-3.5 px-4 font-semibold">Ban Timestamp</th>
                  <th className="py-3.5 px-6 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm">
                {filteredBanned.map((item, idx) => {
                  const targetKey = `${item.jail}:${item.ip}`;
                  const isUnbanning = unbanningTarget === targetKey;
                  const displayTime =
                    item.banTime || item.bannedAt || "Active Ban";

                  return (
                    <tr
                      key={`${item.jail}-${item.ip}-${idx}`}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                          <span className="font-mono font-bold text-red-200">
                            {item.ip}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="px-2 py-0.5 rounded-lg text-xs font-mono bg-white/5 text-slate-300 border border-white/10">
                          {item.jail}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-400 font-mono">
                        {displayTime.includes("T")
                          ? displayTime.replace("T", " ").replace(/\..+/, "")
                          : displayTime}
                      </td>
                      <td className="py-4 px-6 text-right">
                        {isAdmin ? (
                          <button
                            onClick={() => handleUnban(item.jail, item.ip)}
                            disabled={isUnbanning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 hover:text-red-100 text-xs font-semibold rounded-lg transition-all disabled:opacity-50"
                          >
                            <Unlock
                              className={`w-3.5 h-3.5 ${
                                isUnbanning ? "animate-spin" : ""
                              }`}
                            />
                            {isUnbanning ? "Unbanning..." : "Unban"}
                          </button>
                        ) : (
                          <span
                            title="Admin role required to unban IP"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-500 font-medium bg-white/5 rounded-lg border border-white/5 cursor-not-allowed opacity-60"
                          >
                            <Lock className="w-3 h-3" />
                            Admin Only
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Fail2BanManager;
