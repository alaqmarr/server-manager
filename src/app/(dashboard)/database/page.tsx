"use client";
import { useState, useEffect } from "react";
import { Database, Play, Table, DatabaseZap, Search } from "lucide-react";

export default function DatabasePage() {
  const [dbPath, setDbPath] = useState("/home/ubuntu/server-manager/server-manager.db");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [schema, setSchema] = useState<any>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", dbPath })
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setError(data.error);
        setConnected(false);
      } else {
        setConnected(true);
        setTables(data.tables || []);
        setSchema(data.schema || {});
      }
    } catch (err: any) {
      setError(err.message || "Failed to connect to database");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "query", dbPath, query })
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setError(data.error);
      } else {
        setResults(data.rows || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to execute query");
    } finally {
      setLoading(false);
    }
  };

  const loadTable = (tableName: string) => {
    setQuery(`SELECT * FROM ${tableName} LIMIT 100`);
  };

  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 h-[calc(100vh-2rem)] flex flex-col">
      <div className="flex items-center justify-between pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <Database className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Database Inspector</h1>
            <p className="text-slate-400 text-sm mt-1.5">Connect and query SQLite databases directly</p>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <input 
          type="text" 
          value={dbPath} 
          onChange={e => setDbPath(e.target.value)} 
          className="flex-1 bg-surface-950 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-500/50" 
          placeholder="/absolute/path/to/database.db"
        />
        <button 
          onClick={handleConnect} 
          disabled={loading || !dbPath}
          className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-lg transition-all flex items-center gap-2"
        >
          <DatabaseZap className="w-4 h-4" />
          Connect
        </button>
      </div>

      {connected && (
        <div className="flex-1 flex gap-6 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 flex flex-col bg-surface-950 border border-white/5 rounded-2xl shadow-xl overflow-hidden shrink-0">
            <div className="p-4 border-b border-white/5 bg-surface-900/50 text-sm font-semibold text-slate-300">
              Tables
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {tables.length === 0 ? <p className="p-4 text-xs text-slate-500 text-center">No tables found</p> : null}
              {tables.map(table => (
                <div key={table} className="mb-1">
                  <button onClick={() => loadTable(table)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm text-brand-400 font-medium flex items-center gap-2 transition-colors">
                    <Table className="w-4 h-4 text-slate-500" /> {table}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 flex flex-col gap-6 overflow-hidden">
            {/* Editor */}
            <div className="h-48 flex flex-col bg-surface-950 border border-white/5 rounded-2xl shadow-xl overflow-hidden shrink-0">
              <textarea 
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Enter SQL query..."
                className="flex-1 w-full bg-transparent p-4 text-slate-300 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/30"
              />
              <div className="p-3 bg-surface-900/50 border-t border-white/5 flex justify-end">
                <button 
                  onClick={handleQuery}
                  disabled={loading || !query}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4" /> Execute
                </button>
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 flex flex-col bg-surface-950 border border-white/5 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 border-b border-white/5 bg-surface-900/50 text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Search className="w-4 h-4 text-brand-400" /> Results
              </div>
              <div className="flex-1 overflow-auto p-4">
                {error && <div className="text-red-400 text-sm font-mono whitespace-pre-wrap">{error}</div>}
                {results && results.length === 0 && <div className="text-slate-500 text-sm italic">0 rows returned.</div>}
                {results && results.length > 0 && (
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-white/10">
                        {Object.keys(results[0]).map(col => (
                          <th key={col} className="px-4 py-2 text-xs font-semibold text-brand-400 tracking-wider sticky top-0 bg-surface-950 shadow-sm">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row, i) => (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          {Object.values(row).map((val: any, j) => (
                            <td key={j} className="px-4 py-2 text-sm text-slate-300 font-mono">
                              {val === null ? <span className="text-slate-600 italic">null</span> : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
