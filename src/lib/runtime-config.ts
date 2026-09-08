export function getProductionConfigIssues(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const issues: string[] = [];
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    issues.push("AUTH_SECRET");
  }
  if (!env.DATABASE_URL) {
    issues.push("DATABASE_URL");
  }
  return issues;
}
