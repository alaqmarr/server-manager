"use client";
import { useState, useEffect } from "react";
import { Folder, File, CornerLeftUp, Save, Plus, Trash2, Edit3, X } from "lucide-react";
import Editor from "@monaco-editor/react";

export default function FilesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [currentDir, setCurrentDir] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [createName, setCreateName] = useState("");

  useEffect(() => { loadDir(); }, []);

  const loadDir = async (dir?: string) => {
    setLoading(true);
    const res = await fetch(`/api/files?dir=${encodeURIComponent(dir || currentDir)}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
      setCurrentDir(data.currentDir);
      setParentDir(data.parentDir);
    }
    setLoading(false);
  };

  const loadFile = async (path: string) => {
    setLoading(true);
    const res = await fetch("/api/files", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action: "read", target: path }) });
    if (res.ok) {
      const data = await res.json();
      setContent(data.content || "");
      setSelectedFile(path);
    }
    setLoading(false);
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setLoading(true);
    await fetch("/api/files", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action: "save", target: selectedFile, content }) });
    setLoading(false);
    alert("Saved!");
  };

  const handleDelete = async (path: string) => {
    if(!confirm("Delete this?")) return;
    await fetch("/api/files", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action: "delete", target: path }) });
    if (selectedFile === path) setSelectedFile(null);
    loadDir(currentDir);
  };

  const handleCreate = async (isDir: boolean) => {
    if (!createName) return;
    const target = currentDir + "/" + createName;
    const action = isDir ? "mkdir" : "save";
    await fetch("/api/files", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action, target, content: "" }) });
    setCreateName("");
    loadDir(currentDir);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[75vh]">
      <div className="card-gradient rounded-2xl border border-white/5 flex flex-col shadow-2xl">
        <div className="p-4 border-b border-white/5 bg-surface-900/50 flex flex-col gap-2">
          <h3 className="text-white font-semibold truncate text-xs">{currentDir}</h3>
          <div className="flex gap-2">
            <input placeholder="New file/dir" value={createName} onChange={e=>setCreateName(e.target.value)} className="w-full bg-surface-950 border border-white/10 rounded py-1 px-2 text-xs text-white" />
            <button onClick={() => handleCreate(false)} className="p-1 bg-brand-500/10 text-brand-400 rounded hover:bg-brand-500/20"><Plus className="w-4 h-4"/></button>
            <button onClick={() => handleCreate(true)} className="p-1 bg-yellow-500/10 text-yellow-400 rounded hover:bg-yellow-500/20"><Folder className="w-4 h-4"/></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {currentDir !== parentDir && (
            <button onClick={() => loadDir(parentDir)} className="w-full flex items-center gap-2 p-2 text-sm text-surface-400 hover:bg-white/5 rounded-lg">
              <CornerLeftUp className="w-4 h-4"/> ..
            </button>
          )}
          {items.map(item => (
            <div key={item.path} className="group w-full flex items-center justify-between p-2 text-sm text-surface-300 hover:bg-white/5 rounded-lg transition-colors">
              <button onClick={() => item.isDirectory ? loadDir(item.path) : loadFile(item.path)} className="flex items-center gap-2 flex-1 text-left truncate">
                {item.isDirectory ? <Folder className="w-4 h-4 text-yellow-500 shrink-0"/> : <File className="w-4 h-4 text-brand-400 shrink-0"/>}
                <span className="truncate">{item.name}</span>
              </button>
              <button onClick={() => handleDelete(item.path)} className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5"/></button>
            </div>
          ))}
        </div>
      </div>
      
      <div className="lg:col-span-3 card-gradient rounded-2xl border border-white/5 flex flex-col shadow-2xl relative">
        <div className="p-4 border-b border-white/5 bg-surface-900/50 flex justify-between items-center">
          <h3 className="text-white font-semibold truncate text-sm">{selectedFile || "Select a file to edit"}</h3>
          {selectedFile && (
            <div className="flex gap-2">
              <button onClick={() => setSelectedFile(null)} className="p-1.5 text-surface-400 hover:text-white rounded-lg"><X className="w-4 h-4"/></button>
              <button onClick={saveFile} className="flex items-center gap-2 px-3 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 text-xs font-semibold rounded-lg">
                <Save className="w-3.5 h-3.5"/> Save
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 relative bg-[#1e1e1e]">
          {selectedFile ? (
            <Editor
              height="100%"
              theme="vs-dark"
              value={content}
              onChange={(v) => setContent(v || "")}
              options={{ minimap: { enabled: false }, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-surface-500 text-sm">No file selected</div>
          )}
        </div>
      </div>
    </div>
  );
}
