import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Database access. Every application query runs inside `withContext`, which opens a transaction,
 * switches to the `authenticated` role and sets the user id, so Postgres row-level security applies
 * exactly as on Supabase. `service` context (background jobs, migrations-adjacent scripts) uses the
 * service_role, which bypasses RLS and must never serve a user request directly.
 */
export interface DbContext {
  userId: string | null;
  role: "authenticated" | "service";
  actorType?: "user" | "ai" | "system" | "integration";
  requestId?: string;
  agentRunId?: string;
  reason?: string;
}

export interface Tx {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T>;
  maybeOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
}

const pools = new Map<string, Pool>();

export function getPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    // An idle client dropped by the server (restart, failover) must not crash the process.
    pool.on("error", (err) => console.error(`[db] idle client error: ${err.message}`));
    pools.set(connectionString, pool);
  }
  return pool;
}

export async function closePools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

function wrap(client: PoolClient): Tx {
  return {
    async query<T extends QueryResultRow>(text: string, params?: unknown[]) {
      return (await client.query<T>(text, params as unknown[])).rows;
    },
    async one<T extends QueryResultRow>(text: string, params?: unknown[]) {
      const rows = (await client.query<T>(text, params as unknown[])).rows;
      if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
      return rows[0];
    },
    async maybeOne<T extends QueryResultRow>(text: string, params?: unknown[]) {
      const rows = (await client.query<T>(text, params as unknown[])).rows;
      return (rows[0] as T | undefined) ?? null;
    },
  };
}

export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>, pool: Pool = getPool()): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (ctx.role === "authenticated") {
      if (!ctx.userId) throw new Error("authenticated context requires a user id");
      await client.query("set local role authenticated");
    } else {
      await client.query("set local role service_role");
    }
    const claims = ctx.userId ? JSON.stringify({ sub: ctx.userId, role: ctx.role === "service" ? "service_role" : "authenticated" }) : "";
    await client.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('app.actor_type', $3, true),
              set_config('app.request_id', $4, true),
              set_config('app.agent_run_id', $5, true),
              set_config('app.reason', $6, true)`,
      [claims, ctx.userId ?? "", ctx.actorType ?? (ctx.userId ? "user" : "system"), ctx.requestId ?? "", ctx.agentRunId ?? "", ctx.reason ?? ""],
    );
    const result = await fn(wrap(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Translates Postgres errors raised by our guards into user-facing messages. */
export function describeDbError(error: unknown): string {
  const e = error as { code?: string; message?: string; constraint?: string };
  if (e?.code === "23505") return "This already exists (duplicate value).";
  if (e?.code === "23503") return "This refers to something that does not exist or belongs to another product.";
  if (e?.code === "23514") return `A value is not allowed here${e.constraint ? ` (${e.constraint})` : ""}.`;
  if (e?.code === "42501") return "You do not have access to this record.";
  if (e?.code?.startsWith("P0")) return e.message ?? "Rejected by a safety rule.";
  return "Unexpected database error.";
}
