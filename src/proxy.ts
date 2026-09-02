import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Next.js 16: the middleware convention is renamed to proxy.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login"],
};
