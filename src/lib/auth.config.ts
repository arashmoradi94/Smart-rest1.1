import type { NextAuthConfig } from "next-auth";
import { prisma } from "@/lib/db";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.username = user.username;
      }

      if (typeof token.id !== "string") return token;

      const currentUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: { id: true, name: true, username: true, role: true, passwordChangedAt: true },
      });

      if (!currentUser) {
        return null;
      }
      const currentPasswordVersion = currentUser.passwordChangedAt?.toISOString() ?? null;
      if ("passwordChangedAt" in token && token.passwordChangedAt !== currentPasswordVersion) {
        return null;
      }
      token.passwordChangedAt = currentPasswordVersion;

      token.id = currentUser.id;
      token.role = currentUser.role as "EMPLOYEE" | "SUPERVISOR" | "ADMIN";
      token.username = currentUser.username;
      return token;
    },
    session({ session, token }) {
      const sessionUserId = typeof token.id === "string" ? token.id : undefined;
      if (!sessionUserId) {
        return { ...session, user: undefined };
      }

      session.user = {
        id: sessionUserId,
        name: session.user?.name ?? "",
        username: (token.username as string) ?? session.user?.username ?? "",
        role: (token.role as "EMPLOYEE" | "SUPERVISOR" | "ADMIN") ?? "EMPLOYEE",
      } as typeof session.user;
      return session;
    },
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      const isLoggedIn = !!auth?.user;
      const isTeamLead = auth?.user?.role === "ADMIN" || auth?.user?.role === "SUPERVISOR";

      if (pathname.startsWith("/login")) {
        if (isLoggedIn) {
          const role = auth.user.role;
          return Response.redirect(
            new URL(role === "EMPLOYEE" ? "/dashboard" : "/admin", request.url),
          );
        }
        return true;
      }

      if (!isLoggedIn) return false;

      if (pathname.startsWith("/admin") && !isTeamLead) {
        return Response.redirect(new URL("/dashboard", request.url));
      }

      if (pathname.startsWith("/dashboard") && isTeamLead) {
        return Response.redirect(new URL("/admin", request.url));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
