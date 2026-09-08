import { Suspense } from "react";
import { redirect } from "next/navigation";
import { adminExists } from "@/lib/db";
import { auth } from "@/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!adminExists()) {
    redirect("/setup");
  }

  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Sign In to PM2 Manager
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Enter your credentials to access the server management console.
          </p>
        </div>

        <Suspense fallback={<div className="text-center text-sm text-zinc-500">Loading form...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
