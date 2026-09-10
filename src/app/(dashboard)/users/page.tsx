"use client";
import { useState, useEffect } from "react";
import { Shield, Plus, Trash2, Users } from "lucide-react";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer");
  const [allowedProcess, setAllowedProcess] = useState("");

  const fetchUsers = async () => {
    const res = await fetch("/api/users");
    const data = await res.json();
    if (data.users) setUsers(data.users);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role, allowedProcess: role === "client" ? allowedProcess : undefined })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else {
      setUsername("");
      setPassword("");
      setAllowedProcess("");
      fetchUsers();
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4 border-b border-white/5 pb-6">
        <div className="p-3 bg-brand-500/10 rounded-xl border border-brand-500/20">
          <Users className="w-6 h-6 text-brand-400" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-white">Users</h1>
          <p className="text-sm text-slate-400">Manage admins, developers, and clients.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <div className="bg-surface-900 rounded-xl border border-white/5 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Create User</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Username</label>
                <input value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-surface-950 border border-white/10 rounded-lg p-2 text-white" required minLength={3} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-surface-950 border border-white/10 rounded-lg p-2 text-white" required minLength={8} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Role</label>
                <select value={role} onChange={e => setRole(e.target.value)} className="w-full bg-surface-950 border border-white/10 rounded-lg p-2 text-white">
                  <option value="developer">Developer</option>
                  <option value="admin">Admin</option>
                  <option value="client">Client</option>
                </select>
              </div>
              {role === "client" && (
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Allowed PM2 Process</label>
                  <input value={allowedProcess} onChange={e => setAllowedProcess(e.target.value)} placeholder="e.g. clientapp" className="w-full bg-surface-950 border border-white/10 rounded-lg p-2 text-white" required />
                </div>
              )}
              <button type="submit" className="w-full bg-brand-500 text-slate-950 font-bold py-2 rounded-lg hover:bg-brand-600 transition-colors">
                Create User
              </button>
            </form>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-surface-900 rounded-xl border border-white/5 overflow-hidden">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-surface-950 text-slate-400 border-b border-white/5">
                <tr>
                  <th className="p-4 font-medium">ID</th>
                  <th className="p-4 font-medium">Username</th>
                  <th className="p-4 font-medium">Role</th>
                  <th className="p-4 font-medium">Allowed Process</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={4} className="p-4 text-center">Loading...</td></tr> : users.map(u => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="p-4">{u.id}</td>
                    <td className="p-4 font-medium text-white">{u.username}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : u.role === 'client' ? 'bg-blue-500/20 text-blue-400' : 'bg-brand-500/20 text-brand-400'}`}>
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-xs">{u.allowedProcess || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
