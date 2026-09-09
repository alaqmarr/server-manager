"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Zap,
  X,
} from "lucide-react";

export interface UptimeMonitor {
  id: number;
  name: string;
  url: string;
  intervalSeconds: number;
  status: "UP" | "DOWN" | "PENDING" | string;
  uptimePercentage: number;
  lastCheck: string | null;
  lastResponseTime: number;
  avgResponseTimeMs?: number;
  createdAt: string;
}

export function UptimeDashboard() {
  const [monitors, setMonitors] = useState<UptimeMonitor[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newUrl, setNewUrl] = useState<string>("");
  const [newInterval, setNewInterval] = useState<number>(60);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchMonitors = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/uptime");
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const json = await res.json();
      if (json.success && Array.isArray(json.monitors)) {
        setMonitors(json.monitors);
      } else {
        setMonitors([]);
      }
    } catch (err: any) {
      console.error("Error fetching uptime monitors:", err);
      setError(err.message || "Failed to load uptime monitors");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitors(false);
    const interval = setInterval(() => {
      fetchMonitors(false);
    }, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [fetchMonitors]);

  // Trigger Immediate Health Check
  const handleCheckNow = async (id: number) => {
    setCheckingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/uptime/check?id=${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Check failed (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.success) {
        setSuccessMessage(`Check completed: Monitor is ${json.check.status} (${json.check.responseTimeMs || json.check.responseTime}ms)`);
        setTimeout(() => setSuccessMessage(null), 4000);
        await fetchMonitors(false);
      }
    } catch (err: any) {
      setError(err.message || "Health check failed");
    } finally {
      setCheckingId(null);
    }
  };

  // Delete Monitor
  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this uptime monitor?")) {
      return;
    }

    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/uptime?id=${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Delete failed (HTTP ${res.status})`);
      }
      setSuccessMessage("Monitor deleted successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      setError(err.message || "Failed to delete monitor");
    } finally {
      setDeletingId(null);
    }
  };

  // Create Monitor
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!newName.trim()) {
      setFormError("Monitor name is required");
      return;
    }

    if (!newUrl.trim() || (!newUrl.startsWith("http://") && !newUrl.startsWith("https://"))) {
      setFormError("Valid HTTP or HTTPS URL is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/uptime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          url: newUrl.trim(),
          intervalSeconds: Number(newInterval) || 60,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to create monitor (HTTP ${res.status})`);
      }

      setSuccessMessage(`Monitor "${newName}" created successfully`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setIsModalOpen(false);
      setNewName("");
      setNewUrl("");
      setNewInterval(60);
      await fetchMonitors(false);
    } catch (err: any) {
      setFormError(err.message || "Failed to create monitor");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatRelativeTime = (isoString: string | null): string => {
    if (!isoString) return "Never";
    const diffSeconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diffSeconds < 10) return "Just now";
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const mins = Math.floor(diffSeconds / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Summary Metrics
  const totalMonitors = monitors.length;
  const upMonitors = monitors.filter((m) => m.status === "UP").length;
  const downMonitors = monitors.filter((m) => m.status === "DOWN").length;
  const overallSla =
    totalMonitors > 0
      ? (
          monitors.reduce((acc, m) => acc + (m.uptimePercentage ?? 100), 0) /
          totalMonitors
        ).toFixed(2)
      : "100.0";

  return (
    <div className="card-gradient rounded-2xl p-6 border border-white/5 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
            <Globe className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Uptime Monitoring & SLA
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Continuous URL health probes and availability tracking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchMonitors(true)}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/5 transition-colors disabled:opacity-50"
            title="Refresh monitors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`} />
          </button>

          <button
            onClick={() => {
              setIsModalOpen(true);
              setFormError(null);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-semibold text-xs rounded-xl border border-emerald-500/30 transition-all duration-200 shadow-lg shadow-emerald-500/10"
          >
            <Plus className="w-4 h-4" />
            Add Monitor
          </button>
        </div>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-300 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-blue-400" /> Monitored Targets
          </span>
          <p className="text-lg font-bold text-white mt-1">{totalMonitors}</p>
        </div>
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Operational (UP)
          </span>
          <p className="text-lg font-bold text-emerald-400 mt-1">{upMonitors}</p>
        </div>
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-red-400" /> Outages (DOWN)
          </span>
          <p className="text-lg font-bold text-red-400 mt-1">{downMonitors}</p>
        </div>
        <div className="p-3 bg-surface-950/40 rounded-xl border border-white/5">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-400" /> Fleet SLA Uptime
          </span>
          <p className="text-lg font-bold text-white mt-1">{overallSla}%</p>
        </div>
      </div>

      {/* Monitors Table */}
      {isLoading ? (
        <div className="h-48 flex items-center justify-center border border-white/5 rounded-xl bg-surface-950/20 animate-pulse">
          <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
        </div>
      ) : monitors.length === 0 ? (
        <div className="h-56 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl bg-surface-950/20 text-center p-6">
          <Globe className="w-10 h-10 text-slate-600 mb-2" />
          <p className="text-sm font-semibold text-slate-300">No Uptime Monitors Configured</p>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Add HTTP or HTTPS endpoints to monitor availability, latency, and SLA compliance.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="mt-4 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold rounded-lg border border-emerald-500/30 transition-colors"
          >
            Create First Monitor
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-surface-950/30">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/5 text-slate-400 uppercase tracking-wider font-semibold bg-surface-950/50">
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Monitor Target</th>
                <th className="py-3 px-4">Availability (SLA)</th>
                <th className="py-3 px-4">Latency</th>
                <th className="py-3 px-4">Interval</th>
                <th className="py-3 px-4">Last Check</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {monitors.map((m) => {
                const isChecking = checkingId === m.id;
                const isDeleting = deletingId === m.id;
                const sla = typeof m.uptimePercentage === "number" ? m.uptimePercentage : 100.0;
                const isUp = m.status === "UP";
                const isDown = m.status === "DOWN";

                return (
                  <tr key={m.id} className="hover:bg-white/[0.02] transition-colors group">
                    {/* Status Badge */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {isUp ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          UP
                        </span>
                      ) : isDown ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                          DOWN
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          PENDING
                        </span>
                      )}
                    </td>

                    {/* Name & URL */}
                    <td className="py-3.5 px-4 max-w-xs truncate">
                      <div className="font-semibold text-white text-sm truncate">{m.name}</div>
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-400 hover:text-emerald-400 transition-colors inline-flex items-center gap-1 text-[11px] truncate mt-0.5"
                      >
                        <span className="truncate max-w-[200px]">{m.url}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
                      </a>
                    </td>

                    {/* SLA Uptime % */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{sla.toFixed(1)}%</span>
                        <div className="w-16 bg-surface-900 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full ${
                              sla >= 99 ? "bg-emerald-400" : sla >= 90 ? "bg-amber-400" : "bg-red-400"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(5, sla))}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Latency */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-slate-300">
                      {m.lastResponseTime > 0 ? (
                        <span className="inline-flex items-center gap-1 text-slate-200">
                          <Zap className="w-3 h-3 text-amber-400" />
                          {m.lastResponseTime}ms
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>

                    {/* Interval */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {m.intervalSeconds}s
                      </span>
                    </td>

                    {/* Last Check */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                      {formatRelativeTime(m.lastCheck)}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleCheckNow(m.id)}
                          disabled={isChecking}
                          className="px-2.5 py-1 bg-white/5 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300 border border-white/5 hover:border-emerald-500/20 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-50 inline-flex items-center gap-1"
                          title="Trigger immediate health ping"
                        >
                          <RefreshCw className={`w-3 h-3 ${isChecking ? "animate-spin text-emerald-400" : ""}`} />
                          Check Now
                        </button>

                        <button
                          onClick={() => handleDelete(m.id)}
                          disabled={isDeleting}
                          className="p-1.5 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/5 hover:border-red-500/20 rounded-lg transition-all duration-150 disabled:opacity-50"
                          title="Delete monitor"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Monitor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card-gradient bg-surface-950 border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5 font-bold text-white text-base">
                <Globe className="w-5 h-5 text-emerald-400" />
                Add Uptime Monitor
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  Monitor Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production API"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-surface-900 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  Endpoint URL (HTTP/HTTPS)
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://api.example.com/health"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full bg-surface-900 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 transition-colors font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  Check Interval
                </label>
                <select
                  value={newInterval}
                  onChange={(e) => setNewInterval(Number(e.target.value))}
                  className="w-full bg-surface-900 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-400 transition-colors"
                >
                  <option value={30}>Every 30 seconds</option>
                  <option value={60}>Every 1 minute (Recommended)</option>
                  <option value={120}>Every 2 minutes</option>
                  <option value={300}>Every 5 minutes</option>
                  <option value={600}>Every 10 minutes</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Create Monitor
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UptimeDashboard;
