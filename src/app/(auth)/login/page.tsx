import LoginForm from "./LoginForm";
import { Hexagon } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-500/10 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md card-gradient p-8 rounded-3xl border border-white/5 shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-500">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-brand-500/10 rounded-2xl border border-brand-500/20 shadow-[0_0_15px_rgba(45,212,191,0.15)] mb-4">
            <Hexagon className="w-8 h-8 text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Welcome to Nexus</h1>
          <p className="text-slate-400 text-sm mt-2 text-center">
            Sign in to access your server dashboard
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
