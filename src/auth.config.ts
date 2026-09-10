import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname === "/login";
      const isOnSetup = nextUrl.pathname === "/setup";
      const isPublicApi =
        nextUrl.pathname.startsWith("/api/auth") ||
        nextUrl.pathname.startsWith("/api/setup") ||
        nextUrl.pathname.startsWith("/api/deploy/webhook") ||
        nextUrl.pathname.startsWith("/api/discord");

      // Always allow public APIs and setup route
      if (isPublicApi) return true;
      if (isOnSetup) return true;

      // Redirect authenticated users away from /login
      if (isOnLogin) {
        if (isLoggedIn) {
          const user = auth.user as any;
          if (user?.role === "client" && user?.allowedProcess) {
            return Response.redirect(new URL(`/client/${user.allowedProcess}`, nextUrl));
          }
          return Response.redirect(new URL("/", nextUrl));
        }
        return true;
      }

      // Deny access to protected routes if unauthenticated
      if (!isLoggedIn) {
        if (nextUrl.pathname.startsWith("/api/")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        return true;
      }

      // If user is a client, prevent them from accessing root or other admin pages
      const user = auth?.user as any;
      if (user?.role === "client") {
        if (!nextUrl.pathname.startsWith("/client/") && !nextUrl.pathname.startsWith("/api/")) {
           if (user.allowedProcess) {
             return Response.redirect(new URL(`/client/${user.allowedProcess}`, nextUrl));
           } else {
             // Fallback if misconfigured
             return false;
           }
        }
      }

      return true;
    },
  },
  providers: [],
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET || "default_development_auth_secret_pmmanager_32chars",
};
