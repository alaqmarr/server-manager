import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

export default NextAuth(authConfig).auth((req) => {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  
  const user = (req as any).auth?.user;
  
  // Manually enforce authentication redirect if NextAuth authorized callback falls through
  if (!user && !url.pathname.startsWith("/login") && !url.pathname.startsWith("/api/auth")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (hostname.endsWith(".nexus.alaqmar.dev") && hostname !== "nexus.alaqmar.dev") {
    const processName = hostname.replace(".nexus.alaqmar.dev", "");
    if (processName && !processName.includes(".")) {
      if (user?.role === "client" && user.allowedProcess !== processName) {
        return new NextResponse("Unauthorized: You do not have permission to view this application.", { status: 403 });
      }
      
      // Do not rewrite /api/ or /login requests so they hit the global routes
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/login")) {
        return NextResponse.rewrite(new URL(`/client/${processName}${url.pathname}`, req.url));
      }
    }
  }

  if (hostname.endsWith(".localhost:3444") || hostname.endsWith(".localhost:3000")) {
     const processName = hostname.split(".")[0];
     if (processName && processName !== "localhost") {
         if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/login")) {
             return NextResponse.rewrite(new URL(`/client/${processName}${url.pathname}`, req.url));
         }
     }
  }
  
  return NextResponse.next();
});

export const config = {
  // https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
