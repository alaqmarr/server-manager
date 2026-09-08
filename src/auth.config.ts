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
        nextUrl.pathname.startsWith("/api/setup");

      // Always allow public APIs and setup route
      if (isPublicApi) return true;
      if (isOnSetup) return true;

      // Redirect authenticated users away from /login to dashboard
      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      // Deny access to protected routes if unauthenticated -> redirects to signIn page (/login)
      if (!isLoggedIn) {
        if (nextUrl.pathname.startsWith("/api/")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        return false;
      }

      return true;
    },
  },
  providers: [],
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET || "default_development_auth_secret_pmmanager_32chars",
};
