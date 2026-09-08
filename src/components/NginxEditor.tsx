"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileCode,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileCheck,
  RotateCcw,
  Shield,
  FolderOpen,
  Terminal,
  Clock,
  HardDrive,
  Copy,
  Check,
} from "lucide-react";

export interface NginxFileEntry {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface NginxFilesResponse {
  success: boolean;
  files: NginxFileEntry[];
}

export interface NginxContentResponse {
  success: boolean;
  relativePath: string;
  content: string;
}

export interface NginxSaveResponse {
  success: boolean;
  message: string;
}

export interface NginxTestResponse {
  success: boolean;
  output: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function NginxEditor() {
  const [files, setFiles] = useState<NginxFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(true);
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [syntaxResult, setSyntaxResult] = useState<NginxTestResponse | null>(null);
  const [statusNotification, setStatusNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Fetch available config files
  const fetchFiles = useCallback(async (selectPath?: string) => {
    setIsLoadingFiles(true);
    try {
      const res = await fetch("/api/nginx/files", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load files: HTTP ${res.status}`);
      }
      const data: NginxFilesResponse = await res.json();
      if (data.success && Array.isArray(data.files)) {
        setFiles(data.files);
        if (data.files.length > 0) {
          const target = selectPath || selectedFile || data.files[0].relativePath;
          const exists = data.files.some((f) => f.relativePath === target);
          const toSelect = exists ? target : data.files[0].relativePath;
          setSelectedFile(toSelect);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to enumerate Nginx configuration files";
      console.error("Error fetching nginx files:", msg);
      setStatusNotification({
        type: "error",
        message: msg,
      });
    } finally {
      setIsLoadingFiles(false);
    }
  }, [selectedFile]);

  // Load content of selected file
  const loadFileContent = useCallback(async (fileRelPath: string) => {
    if (!fileRelPath) return;
    setIsLoadingContent(true);
    setSyntaxResult(null);
    try {
      const res = await fetch(
        `/api/nginx/content?file=${encodeURIComponent(fileRelPath)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to read file`);
      }
      const data: NginxContentResponse = await res.json();
      if (data.success) {
        setContent(data.content);
        setOriginalContent(data.content);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Unable to read ${fileRelPath}`;
      console.error("Error reading nginx config:", msg);
      setStatusNotification({
        type: "error",
        message: msg,
      });
    } finally {
      setIsLoadingContent(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchFiles();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchFiles]);

  useEffect(() => {
    if (selectedFile) {
      const timer = setTimeout(() => {
        void loadFileContent(selectedFile);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [selectedFile, loadFileContent]);

  // Handle Save
  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    setStatusNotification(null);
    setSyntaxResult(null);

    try {
      const res = await fetch("/api/nginx/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relativePath: selectedFile,
          content,
        }),
      });

      const data: NginxSaveResponse = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }

      setOriginalContent(content);
      setStatusNotification({
        type: "success",
        message: `Changes saved to ${selectedFile} (automatic .bak backup preserved)`,
      });

      // Refresh file metadata (size, modified time)
      fetchFiles(selectedFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save configuration";
      console.error("Error saving config:", msg);
      setStatusNotification({
        type: "error",
        message: msg,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Syntax Test
  const handleTestSyntax = async () => {
    setIsTesting(true);
    setSyntaxResult(null);

    try {
      const res = await fetch("/api/nginx/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relativePath: selectedFile,
          content,
        }),
      });

      const data: NginxTestResponse = await res.json();
      setSyntaxResult(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute syntax validation";
      console.error("Error testing syntax:", msg);
      setSyntaxResult({
        success: false,
        output: msg,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDiscard = () => {
    setContent(originalContent);
    setSyntaxResult(null);
    setStatusNotification({
      type: "info",
      message: "Reverted unsaved edits to last saved state",
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDirty = content !== originalContent;
  const currentEntry = files.find((f) => f.relativePath === selectedFile);
  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="space-y-6">
      {/* Header & File Selector Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileCode className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  Nginx Configuration Editor
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <Shield className="w-3 h-3" />
                  Secured & Versioned
                </span>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                Inspect, modify, and validate Nginx virtual host and gateway configurations with automatic .bak rollbacks
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleTestSyntax}
              disabled={isTesting || isLoadingContent}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <FileCheck
                className={`w-4 h-4 text-blue-500 ${isTesting ? "animate-pulse" : ""}`}
              />
              {isTesting ? "Testing..." : "Test Syntax"}
            </button>

            {isDirty && (
              <button
                onClick={handleDiscard}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Discard
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={isSaving || isLoadingContent || !isDirty}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className={`w-4 h-4 ${isSaving ? "animate-spin" : ""}`} />
              {isSaving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </div>

        {/* File Tabs & Metadata Bar */}
        <div className="mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <FolderOpen className="w-3.5 h-3.5" />
              Files:
            </span>
            {isLoadingFiles ? (
              <span className="text-xs text-zinc-400 flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Scanning config files...
              </span>
            ) : files.length === 0 ? (
              <span className="text-xs text-zinc-400">No configs detected</span>
            ) : (
              files.map((file) => (
                <button
                  key={file.relativePath}
                  onClick={() => setSelectedFile(file.relativePath)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                    selectedFile === file.relativePath
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold shadow-xs"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  {file.relativePath}
                  <span className="text-[10px] opacity-70 font-mono">
                    ({formatBytes(file.size)})
                  </span>
                </button>
              ))
            )}
            <button
              onClick={() => fetchFiles()}
              title="Refresh config files list"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Current File Metadata */}
          {currentEntry && (
            <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                {formatBytes(currentEntry.size)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(currentEntry.modifiedAt).toLocaleTimeString()}
              </span>
              <span>•</span>
              <span className="font-mono">{lineCount} lines</span>
              {isDirty && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  Unsaved Edits
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status Notification */}
      {statusNotification && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            statusNotification.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-200"
              : statusNotification.type === "error"
              ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-200"
              : "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/50 text-blue-800 dark:text-blue-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusNotification.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : statusNotification.type === "error" ? (
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            ) : (
              <FileCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            )}
            <span>{statusNotification.message}</span>
          </div>
          <button
            onClick={() => setStatusNotification(null)}
            className="text-xs font-semibold underline hover:no-underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Syntax Validation Result Card */}
      {syntaxResult && (
        <div
          className={`p-4 rounded-xl border ${
            syntaxResult.success
              ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50"
              : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {syntaxResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              )}
              <span
                className={
                  syntaxResult.success
                    ? "text-emerald-800 dark:text-emerald-300"
                    : "text-red-800 dark:text-red-300"
                }
              >
                {syntaxResult.success
                  ? "Syntax Verification Succeeded"
                  : "Syntax Verification Failed"}
              </span>
            </div>
            <button
              onClick={() => setSyntaxResult(null)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer"
            >
              Close
            </button>
          </div>
          <pre
            className={`mt-2 p-3 rounded-lg text-xs font-mono whitespace-pre-wrap ${
              syntaxResult.success
                ? "bg-emerald-900/10 text-emerald-900 dark:text-emerald-200"
                : "bg-red-900/10 text-red-900 dark:text-red-200"
            }`}
          >
            {syntaxResult.output}
          </pre>
        </div>
      )}

      {/* Code Editor Container */}
      <div className="bg-zinc-950 rounded-xl border border-zinc-800 shadow-sm overflow-hidden flex flex-col">
        {/* Editor Top Bar */}
        <div className="px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2 font-mono">
            <Terminal className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-200 font-semibold">{selectedFile}</span>
            {isDirty && (
              <span className="w-2 h-2 rounded-full bg-amber-400" title="Modified" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Textarea Area */}
        <div className="relative">
          {isLoadingContent ? (
            <div className="py-24 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mx-auto" />
              <p className="mt-3 text-sm text-zinc-400">
                Loading configuration content...
              </p>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              rows={22}
              className="w-full p-4 font-mono text-sm leading-relaxed text-zinc-100 bg-transparent border-0 resize-y focus:outline-none focus:ring-0 selection:bg-emerald-500/30 selection:text-white"
              placeholder="# Nginx configuration file..."
            />
          )}
        </div>

        {/* Editor Footer */}
        <div className="px-4 py-2 bg-zinc-900/40 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500 font-mono">
          <div>UTF-8 • Nginx Syntax</div>
          <div>
            {isDirty ? (
              <span className="text-amber-400">● Modified (Unsaved)</span>
            ) : (
              <span className="text-zinc-500">● Clean (In Sync)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
