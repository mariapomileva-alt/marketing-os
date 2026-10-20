/**
 * Configuration names. Our own names win; otherwise the names that the Supabase ↔ Vercel integration syncs
 * into the Vercel project are used, so a hosted deployment needs no hand-copied keys.
 */
type Env = Record<string, string | undefined>;

export const databaseUrl = (env: Env = process.env) => env.DATABASE_URL || env.POSTGRES_URL || undefined;
export const supabaseUrl = (env: Env = process.env) => env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || undefined;
export const supabaseAnonKey = (env: Env = process.env) =>
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || undefined;
export const supabaseServiceKey = (env: Env = process.env) => env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || undefined;

/** Names (never values) of settings a hosted deployment still lacks, shown on the sign-in page during setup. */
export function missingHostedSettings(env: Env = process.env): string[] {
  if (env.AUTH_MODE === "dev") return databaseUrl(env) ? [] : ["DATABASE_URL"];
  const missing: string[] = [];
  if (!databaseUrl(env)) missing.push("DATABASE_URL or POSTGRES_URL");
  if (!supabaseUrl(env)) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey(env)) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseServiceKey(env)) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

export const storageDriver = (env: Env = process.env): "supabase" | "local" =>
  env.STORAGE_DRIVER === "supabase" || env.STORAGE_DRIVER === "local" ? env.STORAGE_DRIVER : supabaseServiceKey(env) && supabaseUrl(env) ? "supabase" : "local";
