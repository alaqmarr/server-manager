"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  Terminal,
  Play,
  Pause,
  Trash2,
  ArrowDown,
  Search,
  Copy,
  Check,
  Filter,
  Maximize2,
  Minimize2,
} from "lucide-react";

export interface LogEvent {
  timestamp: string;
  process: string;
  type: "stdout" | "stderr" | "system";
  message: string;
}

interface LogStreamerProps {
  processes?: Array<{ id: number | string; name: string }>;
  initialProcess?: string;
  className?: string;
}

export default function LogStreamer({
  processes = [],
  initialProcess = "all",
  className = "",
}: LogStreamerProps) {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<string>(initialProcess);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [copied, setCopied] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll handler
  useEffect(() => {
    if (autoScroll && !isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, isPaused]);

  // Connect to SSE stream
  useEffect(() => {
    setConnectionStatus("connecting");
    const procParam = encodeURIComponent(selectedProcess);
    const url = `/api/pm2/logs/stream?process=${procParam}&lines=30`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setConnectionStatus("connected");
    };

    eventSource.onmessage = (event) => {
      if (isPausedRef.current) return;
      try {
        const payload: LogEvent = JSON.parse(event.data);
        setLogs((prev) => {
          // Maintain a rolling buffer of max 1000 lines
          const next = [...prev, payload];
          if (next.length > 1000) {
            return next.slice(-1000);
          }
          return next;
        });
      } catch {
        // Fallback for non-JSON or raw text
        setLogs((prev) => [
          ...prev.slice(-999),
          {
            timestamp: new Date().toISOString(),
            process: selectedProcess === "all" ? "pm2" : selectedProcess,
            type: "stdout",
            message: event.data,
          },
        ]);
      }
    };

    eventSource.onerror = () => {
      setConnectionStatus("disconnected");
    };

    return () => {
      eventSource.close();
    };
  }, [selectedProcess]);

  const handleClear = () => {
    setLogs([]);
  };

  const handleCopyLogs = async () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${formatTime(l.timestamp)}] [${l.process}] [${l.type.toUpperCase()}] ${l.message}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  // Filter logs by search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.toLowerCase();
    return logs.filter(
      (log) =>
        log.message.toLowerCase().includes(q) ||
        log.process.toLowerCase().includes(q) ||
        log.type.toLowerCase().includes(q)
    );
  }, [logs, searchQuery]);

  function formatTime(isoStr: string) {
    try {
      const d = new Date(isoStr);
      return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
    } catch {
      return isoStr;
    }
  }

  function getProcessColor(name: string) {
    const lower = name.toLowerCase();
    if (lower.includes("web") || lower.includes("frontend")) {
      return "text-cyan-400 bg-cyan-500/10 border-cyan-500/30";
    }
    if (lower.includes("api") || lower.includes("server")) {
      return "text-purple-400 bg-purple-500/10 border-purple-500/30";
    }
    if (lower.includes("worker") || lower.includes("queue")) {
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    }
    if (lower.includes("system") || lower.includes("pm2")) {
      return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    }
    return "text-blue-400 bg-blue-500/10 border-blue-500/30";
  }

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col transition-all duration-200 ${
        isExpanded ? "fixed inset-4 z-50 max-h-none" : "h-[560px]"
      } ${className}`}
    >
      {/* Console Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-white/10 bg-slate-900/60">
        {/* Left: Terminal Brand & Status */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-sm">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white tracking-wide">
                Real-Time Log Streamer
              </h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                SSE
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="flex h-2 w-2 relative">
                {connectionStatus === "connected" && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    connectionStatus === "connected"
                      ? isPaused
                        ? "bg-amber-400"
                        : "bg-emerald-500"
                      : connectionStatus === "connecting"
                      ? "bg-amber-400 animate-pulse"
                      : "bg-rose-500"
                  }`}
                />
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                {connectionStatus === "connected"
                  ? isPaused
                    ? "Stream Paused"
                    : "Live Streaming"
                  : connectionStatus === "connecting"
                  ? "Connecting to PM2..."
                  : "Disconnected"}
              </span>
              <span className="text-slate-600 text-[11px]">•</span>
              <span className="text-[11px] text-slate-500 font-mono">
                {filteredLogs.length} {filteredLogs.length === 1 ? "line" : "lines"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Controls & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Process Filter Dropdown */}
          <div className="relative">
            <select
              value={selectedProcess}
              onChange={(e) => setSelectedProcess(e.target.value)}
              className="appearance-none pl-8 pr-7 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-white">
                All Processes
              </option>
              {processes.map((p) => (
                <option
                  key={p.id}
                  value={p.name}
                  className="bg-slate-900 text-white"
                >
                  {p.name}
                </option>
              ))}
            </select>
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Search Filter Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 placeholder-slate-500 text-xs w-36 focus:w-48 transition-all focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Auto-Scroll Toggle */}
          <button
            onClick={() => setAutoScroll((prev) => !prev)}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              autoScroll
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
            }`}
          >
            <ArrowDown className={`w-3.5 h-3.5 ${autoScroll ? "animate-bounce" : ""}`} />
            <span className="hidden sm:inline">Auto-scroll</span>
          </button>

          {/* Pause / Resume Button */}
          <button
            onClick={() => setIsPaused((prev) => !prev)}
            title={isPaused ? "Resume log stream" : "Pause log stream"}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              isPaused
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isPaused ? "Resume" : "Pause"}</span>
          </button>

          {/* Copy Logs Button */}
          <button
            onClick={handleCopyLogs}
            disabled={filteredLogs.length === 0}
            title="Copy logs to clipboard"
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-colors disabled:opacity-40"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Clear Console Button */}
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            title="Clear console"
            className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 border border-white/10 text-slate-300 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen / Expand Toggle */}
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? "Collapse console" : "Expand console"}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-1 bg-black/70 custom-scrollbar select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
            <Terminal className="w-10 h-10 mb-3 opacity-30 animate-pulse" />
            <p className="text-sm font-medium">
              {searchQuery ? "No logs matching search criteria" : "Waiting for log events..."}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Events will stream here in real time as processes produce stdout and stderr.
            </p>
          </div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2.5 py-0.5 hover:bg-white/[0.03] px-2 rounded -mx-2 group transition-colors"
            >
              {/* Line Index & Timestamp */}
              <span className="text-slate-600 select-none text-[11px] w-7 text-right shrink-0">
                {idx + 1}
              </span>
              <span className="text-slate-500 select-none text-[11px] shrink-0 font-mono">
                {formatTime(log.timestamp)}
              </span>

              {/* Process Tag */}
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded border font-mono font-medium shrink-0 uppercase tracking-tight ${getProcessColor(
                  log.process
                )}`}
              >
                {log.process}
              </span>

              {/* Type Badge (for stderr or system) */}
              {log.type === "stderr" ? (
                <span className="text-[10px] px-1 py-0.2 rounded bg-rose-500/20 text-rose-400 font-bold shrink-0">
                  ERR
                </span>
              ) : log.type === "system" ? (
                <span className="text-[10px] px-1 py-0.2 rounded bg-sky-500/20 text-sky-400 font-bold shrink-0">
                  SYS
                </span>
              ) : null}

              {/* Log Message */}
              <span
                className={`flex-1 break-all whitespace-pre-wrap ${
                  log.type === "stderr"
                    ? "text-rose-300 font-medium"
                    : log.type === "system"
                    ? "text-sky-300"
                    : "text-slate-200"
                }`}
              >
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
