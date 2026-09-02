import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export type UserRole = "EMPLOYEE" | "SUPERVISOR" | "ADMIN";

declare module "next-auth" {
  interface User {
    role: UserRole;
    username: string;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      username: string;
      role: UserRole;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    username: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "نام کاربری", type: "text" },
        password: { label: "رمز عبور", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username?.toString().trim();
        const password = credentials?.password?.toString();
        if (!username || !password) return null;

        // Brute-force guard: max 10 attempts per username per 5 minutes.
        const { ok } = rateLimit(`login:${username.toLowerCase()}`, 10, 5 * 60_000);
        if (!ok) return null;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
          await logAudit(username, "LOGIN_FAILED", `unknown user:${username}`).catch(() => {});
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          await logAudit(user.id, "LOGIN_FAILED", "wrong password").catch(() => {});
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          username: user.username,
          role: (user.role as UserRole) ?? "EMPLOYEE",
        };
      },
    }),
  ],
});

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session.user;
}

/** EMPLOYEE + SUPERVISOR + ADMIN */
export async function requireAnyUser() {
  return requireAuth();
}

/** SUPERVISOR or ADMIN — team-management permissions */
export async function requireSupervisor() {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "SUPERVISOR") throw new Error("Forbidden");
  return user;
}

/** ADMIN only — settings/user administration */
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") throw new Error("Forbidden");
  return user;
}

export function isTeamLead(role?: string | null): boolean {
  return role === "ADMIN" || role === "SUPERVISOR";
}
