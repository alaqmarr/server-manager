"use client";
import { useState, useEffect } from "react";
import { Play, Plus, Trash2, Save, Terminal, FileCode } from "lucide-react";


const stripAnsi = (str: string) => {
  if (!str) return "";
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
};

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [linkedPm2Process, setLinkedPm2Process] = useState("");
  const [content, setContent] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const loadScripts = async () => {
    try {
      const res = await fetch("/api/scripts");
      if (res.ok) {
        const data = await res.json();
        setScripts(data.scripts || []);
      }
    } catch (err) {
      console.error("Error loading scripts:", err);
    }
  };

  useEffect(() => { loadScripts(); }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content, linkedPm2Process })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("Failed to save script: " + (data.error || res.statusText));
      } else {
        setName("");
        setContent("");
        setLinkedPm2Process("");
        await loadScripts();
      }
    } catch (err: any) {
      alert("Error saving script: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async (id: string) => {
    setLoading(true);
    setOutput("Executing...");
    try {
      const res = await fetch(`/api/scripts/${id}/execute`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setOutput(stripAnsi(data.output || data.error || "No output"));
    } catch (err: any) {
      setOutput("Execution error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert("Failed to delete script: " + (data.error || res.statusText));
      } else {
        await loadScripts();
      }
    } catch (err: any) {
      alert("Error deleting script: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[75vh]">
      <div className="card-gradient rounded-2xl border border-white/5 flex flex-col shadow-2xl p-4 gap-4">
        <h3 className="text-white font-semibold flex items-center gap-2"><FileCode className="w-5 h-5 text-brand-400"/> Scripts</h3>
        <div className="flex flex-col gap-2">
          <input placeholder="Script Name" value={name} onChange={e=>setName(e.target.value)} className="bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          <textarea placeholder="#!/bin/bash\necho 'Hello World'" value={content} onChange={e=>setContent(e.target.value)} className="bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white h-32 font-mono" />
          <button disabled={loading || !name || !content} onClick={handleSave} className="bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2 rounded-lg flex items-center justify-center gap-2 transition-all"><Save className="w-4 h-4"/> Save Script</button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 mt-4">
          {scripts.map(s => (
            <div key={s.id} className="bg-surface-950/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{s.name} {s.linkedPm2Process && <span className="ml-2 text-[10px] uppercase bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30">Linked: {s.linkedPm2Process}</span>}</p>
                <p className="text-xs text-surface-400 font-mono truncate max-w-xs">{s.content.split('\n')[0]}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleRun(s.id)} className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg"><Play className="w-4 h-4"/></button>
                <button onClick={() => handleDelete(s.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg"><Trash2 className="w-4 h-4"/></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card-gradient rounded-2xl border border-white/5 flex flex-col shadow-2xl p-4 gap-4 overflow-hidden">
        <h3 className="text-white font-semibold flex items-center gap-2"><Terminal className="w-5 h-5 text-brand-400"/> Output</h3>
        <pre className="flex-1 overflow-y-auto bg-black border border-white/10 rounded-xl p-4 text-emerald-400 text-sm font-mono whitespace-pre-wrap">{output || "Run a script to see output here."}</pre>
      </div>
    </div>
  );
}
