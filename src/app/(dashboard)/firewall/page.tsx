"use client";
import { useState, useEffect } from "react";
import { Shield, ShieldAlert, ShieldCheck, Plus, Trash2, Power, PowerOff } from "lucide-react";
import Fail2BanManager from "@/components/Fail2BanManager";

export default function FirewallPage() {
  const [active, setActive] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPort, setNewPort] = useState("");
  const [newProto, setNewProto] = useState("tcp");
  const [raw, setRaw] = useState("");

  const loadData = async () => {
    setLoading(true);
    const res = await fetch("/api/firewall");
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (data.active !== undefined) {
      setActive(data.active);
      setRules(data.rules || []);
      setRaw(data.raw || "");
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleAction = async (action: string, id?: string) => {
    if (action === 'delete' && !confirm("Delete this rule?")) return;
    if (action === 'disable' && !confirm("WARNING: Disabling the firewall can expose your server. Continue?")) return;
    
    setLoading(true);
    const payload: any = { action };
    if (id) payload.id = id;
    if (action === 'allow') {
      payload.port = newPort;
      payload.protocol = newProto;
    }

    const res = await fetch("/api/firewall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    if (action === 'allow') setNewPort("");
    loadData();
  };

  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="flex items-center justify-between pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
            <Shield className="w-6 h-6 text-red-400" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Firewall (UFW)</h1>
            <p className="text-slate-400 text-sm mt-1.5">Manage open ports and network security</p>
          </div>
        </div>
        <div>
          <button
            disabled={loading}
            onClick={() => handleAction(active ? 'disable' : 'enable')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}
          >
            {active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
            {active ? "Disable Firewall" : "Enable Firewall"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card-gradient rounded-2xl border border-white/5 shadow-2xl p-6">
            <h3 className="text-white font-semibold flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-brand-400" />
              Active Rules
            </h3>
            
            {!active ? (
              <div className="p-6 bg-red-500/5 border border-red-500/10 rounded-xl text-center">
                <ShieldAlert className="w-12 h-12 text-red-400/50 mx-auto mb-3" />
                <h4 className="text-white font-semibold">Firewall is Inactive</h4>
                <p className="text-slate-400 text-sm mt-1">Enable the firewall to enforce security rules.</p>
              </div>
            ) : rules.length === 0 ? (
              <p className="text-slate-400 text-sm">No rules configured.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="pb-3 font-medium">ID</th>
                      <th className="pb-3 font-medium">To (Port/Proto)</th>
                      <th className="pb-3 font-medium">Action</th>
                      <th className="pb-3 font-medium">From</th>
                      <th className="pb-3 font-medium text-right">Delete</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {rules.map((rule) => (
                      <tr key={rule.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 text-slate-500">[{rule.id}]</td>
                        <td className="py-4 text-white font-mono">{rule.to}</td>
                        <td className="py-4">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${rule.action.includes('ALLOW') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                            {rule.action}
                          </span>
                        </td>
                        <td className="py-4 text-slate-300">{rule.from}</td>
                        <td className="py-4 text-right">
                          <button onClick={() => handleAction('delete', rule.id)} className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card-gradient rounded-2xl border border-white/5 shadow-2xl p-6">
            <h3 className="text-white font-semibold flex items-center gap-2 mb-4">
              <Plus className="w-5 h-5 text-brand-400" />
              Allow Port
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Port Number</label>
                <input type="number" placeholder="e.g. 80, 443, 3000" value={newPort} onChange={e => setNewPort(e.target.value)} className="w-full bg-surface-950 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-500/50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Protocol</label>
                <select value={newProto} onChange={e => setNewProto(e.target.value)} className="w-full bg-surface-950 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-500/50">
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="">Both</option>
                </select>
              </div>
              <button disabled={loading || !newPort || !active} onClick={() => handleAction('allow')} className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 rounded-lg transition-all disabled:opacity-50">
                Allow Port
              </button>
            </div>
          </div>
          
          <div className="card-gradient rounded-2xl border border-white/5 shadow-2xl p-6">
            <h3 className="text-white font-semibold mb-2">Raw UFW Status</h3>
            <pre className="bg-black/50 border border-white/5 rounded-lg p-3 text-xs text-slate-400 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
              {raw || "No data"}
            </pre>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-white/5">
        <Fail2BanManager />
      </div>
    </div>
  );
}
