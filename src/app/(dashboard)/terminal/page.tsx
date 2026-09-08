import WebTerminal from "@/components/WebTerminal";
import { Terminal } from "lucide-react";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function TerminalPage() {
  const session = await auth();
  
  return (
    <div className="p-6 max-w-7xl mx-auto w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="pb-6 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 rounded-lg">
            <Terminal className="w-6 h-6 text-purple-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              Interactive Web Terminal
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
              Execute host commands securely within the browser
            </p>
          </div>
        </div>
      </div>
      
      <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-sm overflow-hidden min-h-[60vh]">
        <WebTerminal username={session?.user?.name || "user"} />
      </div>
    </div>
  );
}
