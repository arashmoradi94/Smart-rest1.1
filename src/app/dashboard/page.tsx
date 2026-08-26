import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <EmployeeDashboard userName={session.user.name} />;
}
