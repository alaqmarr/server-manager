"use client";

import { useEffect, useState } from "react";
import { FileCode, Save, RefreshCw, AlertCircle, CheckCircle, FileText } from "lucide-react";

export interface NginxFileEntry { name: string; relativePath: string; size: number; modifiedAt: string; }

export default function NginxEditor() {
  const [files, setFiles] = useState<NginxFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const res = await fetch("/api/nginx/files");
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();
      if (data.files) {
        setFiles(data.files);
        if (data.files.length > 0) {
          loadContent(data.files[0].relativePath);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadContent = async (filename: string) => {
    setSelectedFile(filename);
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/nginx/content?file=${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error("Failed to load file content");
      const data = await res.json();
      setContent(data.content);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const saveContent = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/nginx/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: selectedFile, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setMessage({ type: "success", text: "Configuration saved and syntax is valid." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[70vh]">
      {/* File List */}
      <div className="card-gradient rounded-2xl border border-white/5 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-surface-900/50 flex items-center gap-2">
          <FileText className="w-4 h-4 text-purple-400" />
          <h3 className="text-white font-semibold text-sm">Sites Available</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {files.map((f) => (
            <button
              key={f.relativePath}
              onClick={() => loadContent(f.relativePath)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                selectedFile === f.relativePath
                  ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"
              }`}
            >
              {f.relativePath}
            </button>
          ))}
          {files.length === 0 && (
            <p className="p-4 text-center text-xs text-slate-500">No configs found</p>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="lg:col-span-3 card-gradient rounded-2xl border border-white/5 flex flex-col overflow-hidden relative">
        {/* Editor Header */}
        <div className="p-4 border-b border-white/5 bg-surface-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-purple-400" />
            <h3 className="text-white font-semibold">{selectedFile || "Select a file"}</h3>
          </div>
          <button
            onClick={saveContent}
            disabled={saving || !selectedFile}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save & Test
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`px-4 py-3 text-sm flex items-start gap-3 border-b border-white/5 ${
            message.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          }`}>
            {message.type === "success" ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <pre className="whitespace-pre-wrap font-mono text-xs">{message.text}</pre>
          </div>
        )}

        {/* Text Area */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 bg-surface-950/50 backdrop-blur-sm z-10 flex items-center justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!selectedFile || loading}
            spellCheck={false}
            className="absolute inset-0 w-full h-full bg-surface-950 text-slate-300 font-mono text-sm p-6 resize-none focus:outline-none focus:ring-inset focus:ring-2 focus:ring-purple-500/20"
            placeholder={selectedFile ? "Config content..." : "Select a config file from the sidebar to edit"}
          />
        </div>
      </div>
    </div>
  );
}
