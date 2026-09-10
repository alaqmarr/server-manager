import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  
  // Wildcard subdomain routing for *.nexus.alaqmar.dev
  // Examples: 
  // aip.nexus.alaqmar.dev -> rewrites to /client/aip
  if (hostname.endsWith(".nexus.alaqmar.dev") && hostname !== "nexus.alaqmar.dev") {
    const processName = hostname.replace(".nexus.alaqmar.dev", "");
    
    // Protect against weird hostnames
    if (processName && !processName.includes(".")) {
      return NextResponse.rewrite(new URL(`/client/${processName}${url.pathname}`, req.url));
    }
  }

  // Also handle local development (e.g. processname.localhost:3000)
  if (hostname.endsWith(".localhost:3444") || hostname.endsWith(".localhost:3000")) {
     const processName = hostname.split(".")[0];
     if (processName && processName !== "localhost") {
         return NextResponse.rewrite(new URL(`/client/${processName}${url.pathname}`, req.url));
     }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
