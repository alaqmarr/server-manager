import NginxEditor from "@/components/NginxEditor";
import { FileCode } from "lucide-react";

export const dynamic = "force-dynamic";

export default function NginxPage() {
  return (
    <div className="p-8 w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <FileCode className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              Nginx Configuration Editor
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
              View and edit your virtual hosts safely with built-in syntax checking
            </p>
          </div>
        </div>
      </div>
      
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden h-[75vh]">
        <NginxEditor />
      </div>
    </div>
  );
}
