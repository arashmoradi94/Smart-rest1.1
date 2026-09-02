import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.id as string,
        name: session.user?.name ?? "",
        username: token.username as string,
        role: token.role as "EMPLOYEE" | "SUPERVISOR" | "ADMIN",
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
