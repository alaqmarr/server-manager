import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

export default NextAuth(authConfig).auth((req) => {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  
  if (hostname.endsWith(".nexus.alaqmar.dev") && hostname !== "nexus.alaqmar.dev") {
    const processName = hostname.replace(".nexus.alaqmar.dev", "");
    if (processName && !processName.includes(".")) {
      const user = (req as any).auth?.user;
      if (user?.role === "client" && user.allowedProcess !== processName) {
        return new NextResponse("Unauthorized: You do not have permission to view this application.", { status: 403 });
      }
      return NextResponse.rewrite(new URL(`/client/${processName}${url.pathname}`, req.url));
    }
  }

  if (hostname.endsWith(".localhost:3444") || hostname.endsWith(".localhost:3000")) {
     const processName = hostname.split(".")[0];
     if (processName && processName !== "localhost") {
         return NextResponse.rewrite(new URL(`/client/${processName}${url.pathname}`, req.url));
     }
  }
  
  return NextResponse.next();
});

export const config = {
  // https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
