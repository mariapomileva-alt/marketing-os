/**
 * Configuration names. Our own names win; otherwise the names that the Supabase ↔ Vercel integration syncs
 * into the Vercel project are used, so a hosted deployment needs no hand-copied keys.
 */
type Env = Record<string, string | undefined>;

export const databaseUrl = (env: Env = process.env) => env.DATABASE_URL || env.POSTGRES_URL || undefined;
export const supabaseUrl = (env: Env = process.env) => env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || undefined;
export const supabaseAnonKey = (env: Env = process.env) =>
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || undefined;
export const storageDriver = (env: Env = process.env): "supabase" | "local" =>
  env.STORAGE_DRIVER === "supabase" || env.STORAGE_DRIVER === "local" ? env.STORAGE_DRIVER : env.SUPABASE_SERVICE_ROLE_KEY && supabaseUrl(env) ? "supabase" : "local";
