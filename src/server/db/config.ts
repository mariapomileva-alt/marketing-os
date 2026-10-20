import type { PoolConfig } from "pg";

/**
 * Connection settings from a URL. Hosted Postgres (Supabase) asks for `sslmode=require`: the connection is
 * encrypted; the server certificate is signed by Supabase's own CA, which is not in Node's trust store, so it is
 * not verified here (libpq's `require` behaves the same way). Pool size stays small on serverless hosts, where
 * every instance opens its own pool against Supabase's connection pooler.
 */
export function pgConfig(url: string): PoolConfig {
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  const max = Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 10));
  if (mode && mode !== "disable") {
    u.searchParams.delete("sslmode");
    // Parameters added by the Supabase ↔ Vercel integration that are not Postgres settings.
    u.searchParams.delete("supa");
    u.searchParams.delete("pgbouncer");
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false }, max };
  }
  return { connectionString: url, max };
}
