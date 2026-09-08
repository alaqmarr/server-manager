"use client";
import { useState, useEffect } from "react";
import { FileText, RefreshCw } from "lucide-react";
import Editor from "@monaco-editor/react";

export default function LogsPage() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState("/var/log/syslog");

  const commonLogs = [
    "/var/log/syslog",
    "/var/log/nginx/error.log",
    "/var/log/nginx/access.log",
    "/var/log/auth.log"
  ];

  useEffect(() => { loadLogs(); }, [file]);

  const loadLogs = async () => {
    setLoading(true);
    const res = await fetch(`/api/logs?file=${encodeURIComponent(file)}`);
    if (res.ok) {
      const data = await res.json();
      setContent(data.content || data.error);
    }
    setLoading(false);
  };

  return (
    <div className="card-gradient rounded-2xl border border-white/5 flex flex-col shadow-2xl h-[75vh]">
      <div className="p-4 border-b border-white/5 bg-surface-900/50 flex flex-wrap gap-4 justify-between items-center">
        <div className="flex items-center gap-4">
          <h3 className="text-white font-semibold flex items-center gap-2"><FileText className="w-5 h-5 text-brand-400"/> System Logs</h3>
          <select value={file} onChange={e=>setFile(e.target.value)} className="bg-surface-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none">
            {commonLogs.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <button disabled={loading} onClick={loadLogs} className="flex items-center gap-2 px-3 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 text-sm font-semibold rounded-lg transition-all">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/> Refresh
        </button>
      </div>
      <div className="flex-1 bg-[#1e1e1e]">
        <Editor
          height="100%"
          language="shell"
          theme="vs-dark"
          value={content}
          options={{ minimap: { enabled: false }, fontSize: 13, readOnly: true, wordWrap: "on" }}
        />
      </div>
    </div>
  );
}
