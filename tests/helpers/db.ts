import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getPool, withContext, type Tx } from "@/server/db/client";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
export const TEST_URL = process.env.TEST_DATABASE_URL!;
export const pool = () => getPool(TEST_URL);

export function asService<T>(fn: (tx: Tx) => Promise<T>) {
  return withContext({ userId: null, role: "service" }, fn, pool());
}
export function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ userId, role: "authenticated" }, fn, pool());
}

/** Creates an auth user + owner workspace; returns ids. */
export async function createOwner(email = `owner-${randomUUID().slice(0, 8)}@example.test`) {
  // auth.users is owned by the auth system (Supabase Auth); tests create users as the database owner.
  const { rows } = await pool().query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  const id = rows[0].id;
  return asService(async (tx) => {
    const { ws } = await tx.one<{ ws: string }>("select public.bootstrap_owner($1, $2, 'Test workspace') as ws", [id, email]);
    return { userId: id, workspaceId: ws };
  });
}

export async function createProduct(userId: string, workspaceId: string, slug = `p-${randomUUID().slice(0, 6)}`) {
  return asUser(userId, (tx) =>
    tx.one<{ id: string }>("insert into products (workspace_id, slug, name) values ($1, $2, $3) returning id", [workspaceId, slug, slug]),
  );
}
