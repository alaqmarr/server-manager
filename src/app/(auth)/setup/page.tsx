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
      <div className="w-full max-w-md bg-card rounded-xl shadow-lg border border-border p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            Initial Server Setup
          </h1>
          <p className="text-sm text-muted-foreground">
            Create an administrator account to manage PM2 processes, open ports, and Nginx configs.
          </p>
        </div>

        <SetupForm />
      </div>
    </div>
  );
}
