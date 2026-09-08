"use client";

import { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, Play } from "lucide-react";

interface OutputLine {
  type: "command" | "stdout" | "stderr" | "error";
  text: string;
}


const stripAnsi = (str: string) => {
  if (!str) return "";
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
};

export default function WebTerminal() {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<OutputLine[]>([
    { type: "stdout", text: "Welcome to Nexus Root Terminal." },
    { type: "stdout", text: "Running as standard user. Be careful." },
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const executeCommand = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!command.trim()) return;

    const currentCmd = command;
    setCommand("");
    setHistory((prev) => [...prev, { type: "command", text: `$ ${currentCmd}` }]);
    setLoading(true);

    try {
      const res = await fetch("/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: currentCmd }),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();

      if (data.error) {
        setHistory((prev) => [...prev, { type: "error", text: data.error }]);
      } else {
        if (data.stdout) setHistory((prev) => [...prev, { type: "stdout", text: stripAnsi(data.stdout) }]);
        if (data.stderr) setHistory((prev) => [...prev, { type: "stderr", text: stripAnsi(data.stderr) }]);
      }
    } catch (err: any) {
      setHistory((prev) => [...prev, { type: "error", text: err.message }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="card-gradient rounded-2xl border border-white/5 flex flex-col h-[70vh] overflow-hidden shadow-2xl relative">
      {/* Mac-like Header */}
      <div className="bg-surface-900/80 backdrop-blur-md px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <div className="text-xs font-mono text-slate-400 font-semibold flex items-center gap-2">
          <TerminalIcon className="w-3 h-3" />
          nexus@server:~
        </div>
        <div className="w-16" /> {/* Spacer */}
      </div>

      {/* Terminal Output */}
      <div 
        className="flex-1 overflow-y-auto p-4 bg-surface-950 font-mono text-sm leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        <div className="space-y-2">
          {history.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {line.type === "command" && <span className="text-brand-400 font-bold">{line.text}</span>}
              {line.type === "stdout" && <span className="text-slate-300">{line.text}</span>}
              {line.type === "stderr" && <span className="text-amber-400">{line.text}</span>}
              {line.type === "error" && <span className="text-red-400">{line.text}</span>}
            </div>
          ))}
          {loading && (
            <div className="text-slate-500 animate-pulse">Executing...</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={executeCommand} className="border-t border-white/5 bg-surface-900/50 p-2 flex">
        <div className="flex-1 flex items-center px-4 py-2 bg-surface-950 rounded-lg border border-white/5 focus-within:border-brand-500/30 focus-within:ring-1 focus-within:ring-brand-500/30 transition-all">
          <span className="text-brand-400 font-mono font-bold mr-3">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={loading}
            className="flex-1 bg-transparent border-none outline-none text-slate-200 font-mono text-sm"
            placeholder="Type a command..."
            autoFocus
            autoComplete="off"
            spellCheck="false"
          />
          <button
            type="submit"
            disabled={loading || !command.trim()}
            className="ml-2 text-slate-500 hover:text-brand-400 disabled:opacity-50 transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
          </button>
        </div>
      </form>
    </div>
  );
}
