import { redirect } from "next/navigation";
import { auth, isTeamLead } from "@/lib/auth";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // SUPERVISOR and ADMIN both manage the team; only EMPLOYEEs are redirected.
  if (!isTeamLead(session.user.role)) redirect("/dashboard");
  return <AdminDashboard adminName={session.user.name} />;
}
