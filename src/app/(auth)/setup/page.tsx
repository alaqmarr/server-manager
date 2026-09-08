import { redirect } from "next/navigation";
import { adminExists } from "@/lib/db";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (adminExists()) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Initial Server Setup
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Create an administrator account to manage PM2 processes, open ports, and Nginx configs.
          </p>
        </div>

        <SetupForm />
      </div>
    </div>
  );
}
