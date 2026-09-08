"use client";

import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import {
  Activity,
  Play,
  Square,
  RotateCw,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Server,
  Cpu,
  Database,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PM2Process {
  id: number | string;
  name: string;
  pid: number;
  status: "online" | "stopped" | "errored";
  mode: "fork" | "cluster";
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  ports?: number[];
}

export interface PM2Summary {
  total: number;
  online: number;
  stopped: number;
  totalMemoryBytes: number;
  avgCpuPercent: number;
}

export interface PM2ListResponse {
  success: boolean;
  mode: "real" | "mock";
  timestamp: number;
  summary: PM2Summary;
  processes: PM2Process[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function formatUptime(uptime: number): string {
  if (!uptime || uptime <= 0) return "—";
  const diff = Math.max(0, Date.now() - uptime);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

const emptySubscribe = () => () => {};

export default function PM2Manager() {
  const [processes, setProcesses] = useState<PM2Process[]>([]);
  const [summary, setSummary] = useState<PM2Summary>({
    total: 0,
    online: 0,
    stopped: 0,
    totalMemoryBytes: 0,
    avgCpuPercent: 0,
  });
  const [mode, setMode] = useState<"real" | "mock">("mock");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number>(60);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/pm2", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to fetch PM2 status: HTTP ${res.status}`);
      }
      const data: PM2ListResponse = await res.json();
      if (data.success) {
        setProcesses(data.processes || []);
        setSummary(
          data.summary || {
            total: data.processes?.length || 0,
            online: data.processes?.filter((p) => p.status === "online").length || 0,
            stopped: data.processes?.filter((p) => p.status === "stopped").length || 0,
            totalMemoryBytes: 0,
            avgCpuPercent: 0,
          }
        );
        setMode(data.mode);
        setLastUpdated(data.timestamp || Date.now());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching PM2 data";
      console.error(msg);
      setStatusMessage({ type: "error", text: msg });
    }
  }, []);

  // Initial load & 60-second polling countdown timer
  useEffect(() => {
    const initTimer = setTimeout(() => {
      void loadData();
    }, 0);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void loadData();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [loadData]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setCountdown(60);
    try {
      await loadData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAction = async (
    action: "start" | "stop" | "restart",
    id: string | number
  ) => {
    const key = `${id}-${action}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    setStatusMessage(null);

    try {
      const res = await fetch("/api/pm2/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || `Action ${action} failed`);
      }

      setStatusMessage({
        type: "success",
        text: `Action "${action}" on process ${id} completed successfully (${data.mode} mode).`,
      });

      // Instantly refresh list to show updated state
      await loadData();
      setCountdown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute action";
      setStatusMessage({ type: "error", text: msg });
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Prepare chart data
  const chartData = processes.map((p) => ({
    name: p.name,
    cpu: p.cpu,
    memoryMB: Number((p.memory / (1024 * 1024)).toFixed(1)),
    status: p.status,
  }));

  return (
    <div className="space-y-6">
      {/* PM2 Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-card rounded-xl border border-border shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-emerald-600 dark:text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-foreground">
                PM2 Process Manager
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  mode === "real"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    mode === "real" ? "bg-emerald-500 animate-pulse" : "bg-blue-500"
                  }`}
                />
                {mode === "real" ? "Host PM2 Active" : "Mock PM2 Engine (Jitter Active)"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time monitoring and lifecycle process controls
              {lastUpdated && ` • Last refreshed ${new Date(lastUpdated).toLocaleTimeString()}`}
            </p>
          </div>
        </div>

        {/* Polling Countdown & Refresh Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-xs font-mono text-secondary-foreground border border-border">
            <Clock className="w-3.5 h-3.5 text-zinc-400 animate-spin-slow" />
            <span>Poll:</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {countdown}s
            </span>
          </div>

          <Button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            variant="default"
            size="sm"
            title="Refresh PM2 metrics now"
            className="h-8"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh Now
          </Button>
        </div>
      </div>

      {/* Status Notifications */}
      {statusMessage && (
        <div
          className={`p-4 rounded-lg flex items-center justify-between gap-3 text-sm ${
            statusMessage.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              : "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs underline cursor-pointer hover:opacity-75"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
            <p className="text-xs text-muted-foreground mt-1">Configured instances</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Online</CardTitle>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{summary.online}</div>
            <p className="text-xs text-muted-foreground mt-1">Active services</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stopped</CardTitle>
            <span className="w-2 h-2 rounded-full bg-zinc-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.stopped}</div>
            <p className="text-xs text-muted-foreground mt-1">Dormant services</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Memory</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBytes(summary.totalMemoryBytes)}</div>
            <p className="text-xs text-muted-foreground mt-1">Resident memory</p>
          </CardContent>
        </Card>

        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg CPU</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.avgCpuPercent}%</div>
            <p className="text-xs text-muted-foreground mt-1">Average load</p>
          </CardContent>
        </Card>
      </div>

      {/* Metrics Chart */}
      {isClient && processes.length > 0 && (
        <div className="p-5 bg-card rounded-xl border border-border shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Resource Utilization by Process
              </h3>
              <p className="text-xs text-muted-foreground">
                CPU % and Memory allocation (updated on 60s cycle)
              </p>
            </div>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(24, 24, 27, 0.95)",
                    border: "1px solid rgba(63, 63, 70, 0.5)",
                    borderRadius: "0.5rem",
                    color: "#fff",
                    fontSize: "0.75rem",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "0.5rem" }} />
                <Bar
                  dataKey="cpu"
                  name="CPU (%)"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
                <Bar
                  dataKey="memoryMB"
                  name="Memory (MB)"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Process Table & Cards */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">
              Active Processes ({processes.length})
            </CardTitle>
          </div>
        </CardHeader>

        {processes.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto opacity-50 mb-2" />
            <p className="text-sm font-medium">No PM2 processes found</p>
            <p className="text-xs opacity-70 mt-1">
              Start PM2 processes or wait for the mock engine to load
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Process</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>PID</TableHead>
                  <TableHead>Ports</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Uptime</TableHead>
                  <TableHead>Restarts</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processes.map((proc) => {
                  const isOnline = proc.status === "online";
                  const isStopped = proc.status === "stopped";
                  const startKey = `${proc.id}-start`;
                  const stopKey = `${proc.id}-stop`;
                  const restartKey = `${proc.id}-restart`;

                  return (
                    <TableRow key={String(proc.id)}>
                      {/* Name & ID */}
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            #{proc.id}
                          </span>
                          <span>{proc.name}</span>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono px-1 py-0 h-4">
                            {proc.mode}
                          </Badge>
                        </div>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <Badge 
                          variant={isOnline ? "default" : isStopped ? "secondary" : "destructive"}
                          className={`gap-1.5 ${isOnline ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400' : ''}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isOnline ? "bg-emerald-500 animate-pulse" : isStopped ? "bg-zinc-400" : "bg-background"
                            }`}
                          />
                          {proc.status}
                        </Badge>
                      </TableCell>

                      {/* PID */}
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {proc.pid || "—"}
                      </TableCell>

                      {/* Ports */}
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {proc.ports && proc.ports.length > 0 ? (
                            proc.ports.map((port, idx) => (
                              <Badge key={idx} variant="outline" className="font-mono text-[10px] px-1 py-0 h-4 text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                                :{port}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>

                      {/* CPU */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs min-w-[3rem]">
                            {proc.cpu.toFixed(1)}%
                          </span>
                          <div className="w-16 bg-secondary rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full ${
                                proc.cpu > 50
                                  ? "bg-destructive"
                                  : proc.cpu > 15
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, proc.cpu))}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>

                      {/* Memory */}
                      <TableCell className="font-mono text-xs">
                        {formatBytes(proc.memory)}
                      </TableCell>

                      {/* Uptime */}
                      <TableCell className="text-xs text-muted-foreground">
                        {formatUptime(proc.uptime)}
                      </TableCell>

                      {/* Restarts */}
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs font-normal">
                          {proc.restarts}
                        </Badge>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-2">
                          {!isOnline && (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => handleAction("start", proc.id)}
                              disabled={actionLoading[startKey]}
                            >
                              <Play className={`w-3 h-3 mr-1 ${actionLoading[startKey] ? "animate-spin" : ""}`} />
                              Start
                            </Button>
                          )}
                          
                          {isOnline && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleAction("stop", proc.id)}
                              disabled={actionLoading[stopKey]}
                            >
                              <Square className={`w-3 h-3 mr-1 ${actionLoading[stopKey] ? "animate-spin" : ""}`} />
                              Stop
                            </Button>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleAction("restart", proc.id)}
                            disabled={actionLoading[restartKey]}
                          >
                            <RotateCw className={`w-3 h-3 mr-1 ${actionLoading[restartKey] ? "animate-spin" : ""}`} />
                            Restart
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
