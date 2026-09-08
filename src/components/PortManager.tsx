"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Network,
  RefreshCw,
  Search,
  AlertCircle,
  Radio,
  Server,
} from "lucide-react";

export interface PortEntry {
  port: number;
  protocol: "TCP" | "UDP";
  address: string;
  process: string;
  pid: number;
  state: string;
}

export interface PortsResponse {
  success: boolean;
  mode: "real" | "mock";
  ports: PortEntry[];
}

export default function PortManager() {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [mode, setMode] = useState<"real" | "mock">("mock");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [protocolFilter, setProtocolFilter] = useState<"ALL" | "TCP" | "UDP">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<Date | null>(null);

  const fetchPorts = useCallback(async (isManual = false) => {
    if (isManual) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await fetch("/api/ports", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data: PortsResponse = await res.json();
      if (data.success && Array.isArray(data.ports)) {
        setPorts(data.ports);
        setMode(data.mode);
        setLastScanned(new Date());
      } else {
        throw new Error("Invalid response format received from server");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load port mappings";
      console.error("Error fetching ports:", msg);
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchPorts();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPorts]);

  const filteredPorts = ports.filter((p) => {
    const matchesProtocol =
      protocolFilter === "ALL" || p.protocol === protocolFilter;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return matchesProtocol;

    const matchesSearch =
      String(p.port).includes(term) ||
      p.process.toLowerCase().includes(term) ||
      p.address.toLowerCase().includes(term) ||
      String(p.pid).includes(term) ||
      p.protocol.toLowerCase().includes(term);

    return matchesProtocol && matchesSearch;
  });

  const tcpCount = ports.filter((p) => p.protocol === "TCP").length;
  const udpCount = ports.filter((p) => p.protocol === "UDP").length;
  const knownCount = ports.filter(
    (p) =>
      !p.process.toLowerCase().includes("unknown") &&
      !p.process.toLowerCase().includes("process (pid")
  ).length;

  return (
    <div className="space-y-6">
      {/* Header & Controls Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  Active Port Discovery
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    mode === "real"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  {mode === "real" ? "Host Sockets" : "Simulated Network"}
                </span>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                Real-time inspection of listening TCP and UDP network sockets mapped to running processes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastScanned && (
              <span className="text-xs text-zinc-400 hidden sm:inline">
                Last scan: {lastScanned.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => fetchPorts(true)}
              disabled={isRefreshing || isLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
              {isRefreshing ? "Scanning..." : "Rescan Ports"}
            </button>
          </div>
        </div>

        {/* Metric Overview Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800/80">
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Total Listening
            </div>
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
              {ports.length}
            </div>
          </div>
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              TCP Listeners
            </div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {tcpCount}
            </div>
          </div>
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              UDP Sockets
            </div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
              {udpCount}
            </div>
          </div>
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Identified Services
            </div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {knownCount}
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by port, service name, address, or PID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700 self-stretch sm:self-auto">
            <button
              onClick={() => setProtocolFilter("ALL")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                protocolFilter === "ALL"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              All Protocols
            </button>
            <button
              onClick={() => setProtocolFilter("TCP")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                protocolFilter === "TCP"
                  ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              TCP
            </button>
            <button
              onClick={() => setProtocolFilter("UDP")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                protocolFilter === "UDP"
                  ? "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-semibold shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              UDP
            </button>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-red-700 dark:text-red-300">
            <span className="font-semibold">Discovery Error: </span>
            {error}
          </div>
          <button
            onClick={() => fetchPorts(true)}
            className="text-xs font-semibold text-red-700 dark:text-red-300 underline hover:no-underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Port Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              Discovering active listening ports...
            </p>
          </div>
        ) : filteredPorts.length === 0 ? (
          <div className="py-16 text-center">
            <Server className="w-10 h-10 text-zinc-400 mx-auto" />
            <p className="mt-3 text-base font-semibold text-zinc-700 dark:text-zinc-300">
              No matching listening ports found
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Try adjusting your search criteria or protocol filters
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/75 dark:bg-zinc-800/40 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  <th className="py-3 px-4">Port</th>
                  <th className="py-3 px-4">Protocol</th>
                  <th className="py-3 px-4">Service / Process</th>
                  <th className="py-3 px-4">Bind Address</th>
                  <th className="py-3 px-4">PID</th>
                  <th className="py-3 px-4 text-right">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                {filteredPorts.map((entry, idx) => (
                  <tr
                    key={`${entry.port}-${entry.protocol}-${entry.address}-${idx}`}
                    className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                        :{entry.port}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          entry.protocol === "TCP"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                            : "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                        }`}
                      >
                        {entry.protocol}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {entry.process}
                        </span>
                        {entry.port === 80 || entry.port === 443 ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            Web Gateway
                          </span>
                        ) : entry.port === 3000 ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            Dashboard App
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {entry.address}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {entry.pid > 0 ? entry.pid : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        {entry.state || "LISTEN"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
