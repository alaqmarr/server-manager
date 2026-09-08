import { Sidebar } from "@/components/Sidebar";
import { auth } from "@/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="flex h-screen bg-surface-950 overflow-hidden text-slate-300 font-sans selection:bg-brand-500/30">
      <Sidebar userName={session?.user?.name || "Admin"} />
      
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen md:p-4 md:pl-0">
        <div className="flex-1 rounded-2xl glass-panel relative overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}
