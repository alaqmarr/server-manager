"use client";

import { useEffect, useState } from "react";
import { 
  FileCode, Save, RefreshCw, AlertCircle, CheckCircle, FileText, 
  Plus, Power, Lock, X, Globe, TerminalSquare 
} from "lucide-react";
import Editor from "@monaco-editor/react";

export interface NginxFileEntry {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  isEnabled?: boolean;
}

export default function NginxEditor() {
  const [files, setFiles] = useState<NginxFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<NginxFileEntry | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSslModal, setShowSslModal] = useState(false);

  // Create form state
  const [createForm, setCreateForm] = useState({ name: "", template: "proxy", domain: "", portOrPath: "" });
  
  // SSL form state
  const [sslForm, setSslForm] = useState({ domain: "", email: "" });

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
        if (data.files.length > 0 && !selectedFile) {
          loadContent(data.files[0]);
        } else if (selectedFile) {
          const updated = data.files.find((f: any) => f.relativePath === selectedFile.relativePath);
          if (updated) setSelectedFile(updated);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadContent = async (file: NginxFileEntry) => {
    setSelectedFile(file);
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/nginx/content?file=${encodeURIComponent(file.relativePath)}`);
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
    if (!selectedFile) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/nginx/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relativePath: selectedFile.relativePath, content }),
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

  const toggleSite = async (enable: boolean) => {
    if (!selectedFile) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/nginx/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: selectedFile.name, enable }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle site");
      setMessage({ type: "success", text: data.message });
      await fetchFiles();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/nginx/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create config");
      
      setMessage({ type: "success", text: "Site created successfully" });
      setShowCreateModal(false);
      await fetchFiles();
      
      const newFile = data.files?.find((f: any) => f.name === `${createForm.name}.conf`);
      if (newFile) loadContent(newFile);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSsl = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/nginx/ssl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sslForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate SSL");
      
      setMessage({ type: "success", text: "SSL Generated:\n" + data.output });
      setShowSslModal(false);
      await fetchFiles();
      if (selectedFile) loadContent(selectedFile);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const isSitesAvailable = selectedFile?.relativePath.startsWith("sites-available/");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[75vh]">
      {/* File List */}
      <div className="card-gradient rounded-2xl border border-white/5 flex flex-col overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-white/5 bg-surface-900/50 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-brand-400" />
              <h3 className="text-white font-semibold">Configs</h3>
            </div>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="p-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 rounded-lg transition-colors"
              title="Create New Site"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {files.map((f) => (
            <button
              key={f.relativePath}
              onClick={() => loadContent(f)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-between ${
                selectedFile?.relativePath === f.relativePath
                  ? "bg-brand-500/10 text-brand-400 border border-brand-500/20"
                  : "text-surface-400 hover:bg-white/5 hover:text-surface-200 border border-transparent"
              }`}
            >
              <span className="truncate pr-2">{f.relativePath}</span>
              {f.isEnabled !== undefined && (
                <span className={`w-2 h-2 rounded-full shrink-0 ${f.isEnabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-surface-600'}`} title={f.isEnabled ? "Enabled" : "Disabled"} />
              )}
            </button>
          ))}
          {files.length === 0 && (
            <p className="p-4 text-center text-xs text-surface-500">No configs found</p>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="lg:col-span-3 card-gradient rounded-2xl border border-white/5 flex flex-col overflow-hidden relative shadow-2xl">
        {/* Editor Header */}
        <div className="p-4 border-b border-white/5 bg-surface-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-500/10 rounded-lg">
              <FileCode className="w-4 h-4 text-brand-400" />
            </div>
            <h3 className="text-white font-semibold truncate max-w-[200px] sm:max-w-xs">{selectedFile?.relativePath || "Select a file"}</h3>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {isSitesAvailable && (
              <>
                <button
                  onClick={() => setShowSslModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-semibold rounded-lg transition-all"
                >
                  <Lock className="w-3.5 h-3.5" /> SSL
                </button>
                <button
                  onClick={() => toggleSite(!selectedFile?.isEnabled)}
                  className={`flex items-center gap-2 px-3 py-1.5 border text-xs font-semibold rounded-lg transition-all ${
                    selectedFile?.isEnabled 
                    ? "bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400" 
                    : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {selectedFile?.isEnabled ? "Disable" : "Enable"}
                </button>
              </>
            )}
            <button
              onClick={saveContent}
              disabled={saving || !selectedFile}
              className="flex items-center gap-2 px-4 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/30 text-brand-400 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save & Test
            </button>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`px-4 py-3 text-sm flex items-start gap-3 border-b border-white/5 ${
            message.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          }`}>
            {message.type === "success" ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <pre className="whitespace-pre-wrap font-mono text-xs max-h-32 overflow-y-auto">{message.text}</pre>
          </div>
        )}

        {/* Monaco Editor */}
        <div className="flex-1 relative bg-[#1e1e1e]">
          {loading && (
            <div className="absolute inset-0 bg-surface-950/60 backdrop-blur-sm z-20 flex items-center justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-brand-500" />
            </div>
          )}
          <Editor
            height="100%"
            language="shell"
            theme="vs-dark"
            value={content}
            onChange={(val) => setContent(val || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              padding: { top: 16 },
              scrollBeyondLastLine: false,
              wordWrap: "on"
            }}
          />
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-brand-400"/> New Nginx Site</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-surface-400 hover:text-white"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Site Name (e.g., myapp)</label>
                <input required value={createForm.name} onChange={e => setCreateForm({...createForm, name: e.target.value})} className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Template</label>
                <select value={createForm.template} onChange={e => setCreateForm({...createForm, template: e.target.value})} className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none">
                  <option value="proxy">Node.js Reverse Proxy</option>
                  <option value="static">Static HTML / Frontend</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Domain (e.g., example.com)</label>
                <input required value={createForm.domain} onChange={e => setCreateForm({...createForm, domain: e.target.value})} className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">{createForm.template === 'proxy' ? 'Target Port (e.g., 3000)' : 'Root Path (e.g., /var/www/html)'}</label>
                <input required value={createForm.portOrPath} onChange={e => setCreateForm({...createForm, portOrPath: e.target.value})} className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
              </div>
              <div className="pt-2">
                <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Plus className="w-4 h-4" />} Create Config
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SSL Modal */}
      {showSslModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Lock className="w-4 h-4 text-yellow-400"/> Generate SSL</h3>
              <button onClick={() => setShowSslModal(false)} className="text-surface-400 hover:text-white"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleSsl} className="p-5 space-y-4">
              <p className="text-sm text-surface-400">Generate a free Let&apos;s Encrypt certificate. Your domain must already point to this server&apos;s IP.</p>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Domain(s) (comma separated)</label>
                <input required placeholder="example.com,www.example.com" value={sslForm.domain} onChange={e => setSslForm({...sslForm, domain: e.target.value})} className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Email Address</label>
                <input type="email" required placeholder="admin@example.com" value={sslForm.email} onChange={e => setSslForm({...sslForm, email: e.target.value})} className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none" />
              </div>
              <div className="pt-2">
                <button type="submit" disabled={loading} className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin"/> : <TerminalSquare className="w-4 h-4" />} Run Certbot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
