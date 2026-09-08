"use client";
import { useState, useEffect } from "react";
import { Clock, Save, RefreshCw } from "lucide-react";
import Editor from "@monaco-editor/react";

export default function CronPage() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadCron(); }, []);

  const loadCron = async () => {
    setLoading(true);
    const res = await fetch("/api/cron");
    if (res.ok) {
      const data = await res.json();
      setContent(data.content);
    }
    setLoading(false);
  };

  const saveCron = async () => {
    setLoading(true);
    const res = await fetch("/api/cron", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ content }) });
    if (res.ok) alert("Crontab updated!");
    setLoading(false);
  };

  return (
    <div className="card-gradient rounded-2xl border border-white/5 flex flex-col shadow-2xl h-[75vh]">
      <div className="p-4 border-b border-white/5 bg-surface-900/50 flex justify-between items-center">
        <h3 className="text-white font-semibold flex items-center gap-2"><Clock className="w-5 h-5 text-yellow-400"/> Crontab Editor</h3>
        <button disabled={loading} onClick={saveCron} className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-sm font-semibold rounded-lg transition-all">
          <Save className="w-4 h-4"/> Save Crontab
        </button>
      </div>
      <div className="flex-1 bg-[#1e1e1e]">
        <Editor
          height="100%"
          language="shell"
          theme="vs-dark"
          value={content}
          onChange={(v) => setContent(v || "")}
          options={{ minimap: { enabled: false }, fontSize: 14 }}
        />
      </div>
    </div>
  );
}
