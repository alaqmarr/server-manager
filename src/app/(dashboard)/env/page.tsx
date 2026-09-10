"use client";
import { useState, useEffect } from "react";
import { FileKey, Plus, Trash2, Save, FolderOpen, RefreshCw } from "lucide-react";

export default function EnvPage() {
  const [dirPath, setDirPath] = useState("/home/ubuntu/server-manager");
  const [envVars, setEnvVars] = useState<{ key: string, value: string }[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [selectedPm2, setSelectedPm2] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedPath, setLoadedPath] = useState("");

  const loadProcesses = async () => {
    try {
      const res = await fetch("/api/pm2");
      if (res.ok) {
        const data = await res.json();
        setProcesses(data.processes || []);
      }
    } catch (err) {
      console.error("Failed to load PM2 processes", err);
    }
  };

  useEffect(() => { loadProcesses(); }, []);

  const loadEnv = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", dirPath })
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setEnvVars(data.envVars || []);
        setLoadedPath(data.path);
      }
    } catch (err: any) {
      alert("Error reading env: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", dirPath: loadedPath.replace('/.env', ''), envData: envVars, pm2Id: selectedPm2 })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else alert(data.message);
    } catch (err: any) {
      alert("Error saving env: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const addVar = () => setEnvVars([...envVars, { key: "", value: "" }]);
  
  const updateVar = (index: number, field: "key" | "value", val: string) => {
    const newVars = [...envVars];
    newVars[index][field] = val;
    setEnvVars(newVars);
  };

  const deleteVar = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="flex items-center gap-4 pb-6 border-b border-white/5">
        <div className="p-3 bg-brand-500/10 rounded-xl border border-brand-500/20 shadow-[0_0_15px_rgba(45,212,191,0.15)]">
          <FileKey className="w-6 h-6 text-brand-400" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Environment Variables</h1>
          <p className="text-slate-400 text-sm mt-1.5">Securely manage .env files for your apps</p>
        </div>
      </div>

      <div className="card-gradient rounded-2xl border border-white/5 shadow-2xl p-6">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Project Directory</label>
            <div className="flex items-center bg-surface-950 border border-white/10 rounded-lg px-4 py-2.5 focus-within:border-brand-500/50">
              <FolderOpen className="w-4 h-4 text-slate-500 mr-3" />
              <input type="text" value={dirPath} onChange={e => setDirPath(e.target.value)} className="w-full bg-transparent text-white outline-none" placeholder="/var/www/myapp" />
            </div>
          </div>
          <button onClick={loadEnv} disabled={loading || !dirPath} className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-lg transition-all flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Load .env
          </button>
        </div>
      </div>

      {loadedPath && (
        <div className="card-gradient rounded-2xl border border-white/5 shadow-2xl overflow-hidden flex flex-col">
          <div className="p-4 bg-surface-900/50 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <FileKey className="w-4 h-4 text-brand-400" />
              {loadedPath}
            </h3>
            <div className="flex items-center gap-4">
              <select value={selectedPm2} onChange={e => setSelectedPm2(e.target.value)} className="bg-surface-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 outline-none">
                <option value="">Do not restart PM2</option>
                {processes.map(p => (
                  <option key={p.id} value={p.id}>Restart: {p.name}</option>
                ))}
              </select>
              <button onClick={addVar} className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 text-white rounded-lg flex items-center gap-2 text-sm transition-colors border border-white/5">
                <Plus className="w-4 h-4" /> Add Variable
              </button>
              <button onClick={handleSave} disabled={loading} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg flex items-center gap-2 text-sm transition-colors">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
          
          <div className="p-6 space-y-3 max-h-[50vh] overflow-y-auto">
            {envVars.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No variables found. Add one to create the .env file.</p>
            ) : (
              envVars.map((item, idx) => (
                <div key={idx} className="flex gap-3 items-start animate-in slide-in-from-left-4">
                  <div className="w-1/3">
                    <input type="text" value={item.key} onChange={e => updateVar(idx, 'key', e.target.value)} placeholder="KEY_NAME" className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-brand-400 font-mono text-sm focus:outline-none focus:border-brand-500/50" />
                  </div>
                  <div className="flex-1 flex gap-2">
                    <input type="text" value={item.value} onChange={e => updateVar(idx, 'value', e.target.value)} placeholder="Value" className="w-full bg-surface-950 border border-white/10 rounded-lg px-3 py-2 text-slate-300 font-mono text-sm focus:outline-none focus:border-brand-500/50" />
                    <button onClick={() => deleteVar(idx)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
