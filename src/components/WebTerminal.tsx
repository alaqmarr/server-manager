"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal as TerminalIcon,
  Trash2,
  Copy,
  Check,
  Loader2,
  Folder,
} from "lucide-react";

export interface TerminalExecuteResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  error?: string;
}

export interface TerminalEntry {
  id: string;
  prompt: string;
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  cwd?: string;
  timestamp: Date;
}

export interface WebTerminalProps {
  username?: string;
  initialCwd?: string;
}

export default function WebTerminal({
  username = "user",
  initialCwd = "",
}: WebTerminalProps) {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [inputCommand, setInputCommand] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [tempInput, setTempInput] = useState<string>("");
  const [currentCwd, setCurrentCwd] = useState<string>(initialCwd);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Compute dir display for prompt: e.g. [user@host:dir]$
  // If currentCwd is empty, displays "dir". Otherwise displays last directory segment.
  const displayDir = currentCwd
    ? currentCwd.split(/[\\/]/).filter(Boolean).pop() || "dir"
    : "dir";

  const promptString = `[${username}@host:${displayDir}]$ `;

  // Auto-scroll to bottom whenever entries change or command runs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, isRunning]);

  // Focus input on mount and when terminal body is clicked
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleContainerClick = () => {
    // Only focus if no text is selected
    const selection = window.getSelection();
    if (!selection || selection.toString().length === 0) {
      inputRef.current?.focus();
    }
  };

  // Clear output log
  const clearTerminal = useCallback(() => {
    setEntries([]);
    setHistoryIndex(-1);
    inputRef.current?.focus();
  }, []);

  // Execute command
  const executeCommand = async (cmdToRun: string) => {
    const rawCmd = cmdToRun;
    const trimmed = rawCmd.trim();

    if (!trimmed) {
      // Empty enter - just print prompt line
      setEntries((prev) => [
        ...prev,
        {
          id: `entry-${Date.now()}-${Math.random()}`,
          prompt: promptString,
          command: "",
          timestamp: new Date(),
        },
      ]);
      setInputCommand("");
      return;
    }

    // Add to history if not identical to last command
    setHistory((prev) => (prev[prev.length - 1] === rawCmd ? prev : [...prev, rawCmd]));
    setHistoryIndex(-1);
    setTempInput("");
    setInputCommand("");

    // Check built-in clear
    if (trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "cls") {
      clearTerminal();
      return;
    }

    // Built-in help
    if (trimmed.toLowerCase() === "help") {
      setEntries((prev) => [
        ...prev,
        {
          id: `entry-${Date.now()}-${Math.random()}`,
          prompt: promptString,
          command: rawCmd,
          stdout:
            "Available Terminal Commands:\n" +
            "  echo <text>       Echo text to terminal\n" +
            "  cd <path>         Change working directory\n" +
            "  pm2 list          List PM2 managed processes\n" +
            "  pm2 logs          View PM2 output logs\n" +
            "  node -v           Display Node.js runtime version\n" +
            "  whoami            Display current host user\n" +
            "  clear             Clear terminal screen\n" +
            "  help              Show this guide",
          exitCode: 0,
          timestamp: new Date(),
        },
      ]);
      return;
    }

    setIsRunning(true);

    try {
      const res = await fetch("/api/terminal/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: rawCmd,
          cwd: currentCwd || undefined,
        }),
      });

      if (res.status === 401) {
        setEntries((prev) => [
          ...prev,
          {
            id: `entry-${Date.now()}-${Math.random()}`,
            prompt: promptString,
            command: rawCmd,
            stderr: "Error: Unauthorized. Please log in to execute terminal commands.",
            exitCode: 401,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setEntries((prev) => [
          ...prev,
          {
            id: `entry-${Date.now()}-${Math.random()}`,
            prompt: promptString,
            command: rawCmd,
            stderr: errData.error || `HTTP ${res.status}: Command failed`,
            exitCode: res.status,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const data: TerminalExecuteResponse = await res.json();

      if (data.cwd) {
        setCurrentCwd(data.cwd);
      }

      setEntries((prev) => [
        ...prev,
        {
          id: `entry-${Date.now()}-${Math.random()}`,
          prompt: promptString,
          command: rawCmd,
          stdout: data.stdout,
          stderr: data.stderr,
          exitCode: data.exitCode,
          cwd: data.cwd,
          timestamp: new Date(),
        },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setEntries((prev) => [
        ...prev,
        {
          id: `entry-${Date.now()}-${Math.random()}`,
          prompt: promptString,
          command: rawCmd,
          stderr: `Terminal Execution Error: ${message}`,
          exitCode: 1,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsRunning(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRunning) return;
    executeCommand(inputCommand);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;

      if (historyIndex === -1) {
        // First press of ArrowUp: save current draft and pick last history item
        setTempInput(inputCommand);
        const newIndex = history.length - 1;
        setHistoryIndex(newIndex);
        setInputCommand(history[newIndex]);
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputCommand(history[newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;

      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInputCommand(history[newIndex]);
      } else {
        // End of history: restore draft
        setHistoryIndex(-1);
        setInputCommand(tempInput);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      clearTerminal();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      if (isRunning) {
        // Can't cancel active child process synchronously from browser, but reset input
        setInputCommand("");
      } else {
        setInputCommand("");
        setHistoryIndex(-1);
      }
    }
  };

  const copyAllOutput = () => {
    const text = entries
      .map((e) => {
        let block = `${e.prompt}${e.command}`;
        if (e.stdout) block += `\n${e.stdout}`;
        if (e.stderr) block += `\n${e.stderr}`;
        return block;
      })
      .join("\n\n");

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const quickCommands = [
    'echo "agent-test"',
    "whoami",
    "node -v",
    "pm2 list",
    "clear",
  ];

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
      {/* Terminal Title Bar */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2 select-none">
        <div className="flex items-center gap-3">
          {/* Mac/Terminal Style Window Control Dots */}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
          </div>

          <div className="flex items-center gap-2 text-zinc-300 font-mono text-xs">
            <TerminalIcon className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-zinc-100">Web Terminal</span>
            <span className="text-zinc-500">•</span>
            <span className="text-zinc-400">bash</span>
            {currentCwd && (
              <>
                <span className="text-zinc-500">•</span>
                <span
                  className="text-zinc-400 max-w-[200px] truncate flex items-center gap-1"
                  title={currentCwd}
                >
                  <Folder className="w-3 h-3 text-zinc-500 inline" />
                  {currentCwd}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Quick preset runner */}
          <div className="hidden sm:flex items-center gap-1 text-xs font-mono">
            {quickCommands.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => {
                  setInputCommand(cmd);
                  executeCommand(cmd);
                }}
                disabled={isRunning}
                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                title={`Run: ${cmd}`}
              >
                {cmd}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={copyAllOutput}
            disabled={entries.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Copy terminal buffer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={clearTerminal}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
            title="Clear terminal log (Ctrl+L)"
          >
            <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Monospace Console Body */}
      <div
        ref={terminalBodyRef}
        onClick={handleContainerClick}
        className="bg-zinc-950 font-mono text-zinc-100 p-4 min-h-[380px] max-h-[540px] overflow-y-auto text-sm select-text flex flex-col space-y-3 cursor-text"
      >
        {/* Welcome Banner */}
        <div className="text-xs text-zinc-500 border-b border-zinc-900 pb-2 select-none">
          <p className="text-zinc-400 font-semibold">
            Next.js Host Web Terminal Console [Unrestricted Execution]
          </p>
          <p>
            Type <span className="text-emerald-400">help</span> for commands,{" "}
            <span className="text-emerald-400">clear</span> to reset screen.
            History available via <span className="text-zinc-300">↑</span> and{" "}
            <span className="text-zinc-300">↓</span> keys.
          </p>
        </div>

        {/* Rendered Command Output Entries */}
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-1">
            {/* Prompt & Executed Command */}
            <div className="flex items-baseline gap-2 text-sm select-none">
              <span className="text-emerald-400 font-semibold select-none">
                {entry.prompt}
              </span>
              <span className="text-zinc-100 font-medium select-text">
                {entry.command}
              </span>
              <span className="text-zinc-600 text-xs ml-auto select-none">
                {entry.timestamp.toLocaleTimeString()}
              </span>
            </div>

            {/* Standard Output */}
            {entry.stdout && (
              <pre className="text-zinc-200 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed select-text pl-2 border-l border-zinc-800/80">
                {entry.stdout}
              </pre>
            )}

            {/* Standard Error */}
            {entry.stderr && (
              <pre className="text-rose-400 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed select-text pl-2 border-l border-rose-900/60">
                {entry.stderr}
              </pre>
            )}

            {/* Non-Zero Exit Code Indicator */}
            {entry.exitCode !== undefined && entry.exitCode !== 0 && (
              <div className="text-xs text-rose-500 font-mono select-none pl-2">
                [process exited with code {entry.exitCode}]
              </div>
            )}
          </div>
        ))}

        {/* Active Command Line Input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-1">
          <span className="text-emerald-400 font-semibold select-none whitespace-nowrap">
            {promptString}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={inputCommand}
            onChange={(e) => setInputCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 bg-transparent border-none outline-none text-zinc-100 font-mono text-sm p-0 focus:ring-0 focus:outline-none placeholder:text-zinc-600"
            placeholder={
              isRunning
                ? "Executing command on host..."
                : 'Type command here (e.g. echo "agent-test")...'
            }
          />
          {isRunning && (
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin flex-shrink-0" />
          )}
        </form>

        {/* Invisible anchor for automatic scrolling */}
        <div ref={bottomRef} />
      </div>

      {/* Terminal Footer Bar */}
      <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500 font-mono select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-zinc-400">Host Terminal Ready</span>
          </span>
          {currentCwd && (
            <span className="hidden md:inline text-zinc-500">
              cwd: {currentCwd}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span>Enter ↵ to run</span>
          <span>•</span>
          <span>↑/↓ for history</span>
        </div>
      </div>
    </div>
  );
}
