import { Client } from "pg";
import { pgConfig } from "../src/server/db/config";
import { queueToken } from "../src/server/security/queue-token";

/**
 * Hosted builds only: schedules the YouTube posting queue in the database (Supabase pg_cron + pg_net), every 5 minutes.
 * The endpoint token is kept in Supabase Vault, not in the job text. Idempotent; a failure only logs a warning, the
 * admin then shows that automatic posting is not running and "Post now" still works.
 */
export async function ensureQueueScheduler(connectionString: string, appUrl: string) {
  const { max: _max, ...config } = pgConfig(connectionString);
  const client = new Client(config);
  await client.connect();
  try {
    await client.query("create extension if not exists pg_cron");
    await client.query("create extension if not exists pg_net with schema extensions");
    const token = queueToken();
    const existing = await client.query<{ id: string }>("select id from vault.secrets where name = 'mos_queue_token'");
    if (existing.rows[0]) await client.query("select vault.update_secret($1::uuid, $2)", [existing.rows[0].id, token]);
    else await client.query("select vault.create_secret($1, 'mos_queue_token', 'Marketing OS posting queue token')", [token]);
    const target = `${appUrl.replace(/\/$/, "")}/api/cron/youtube-post`;
    const command = `select net.http_get(
      url := '${target.replace(/'/g, "''")}',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mos_queue_token')),
      timeout_milliseconds := 60000)`;
    await client.query("select cron.schedule('mos-youtube-post-queue', '*/5 * * * *', $1)", [command]);
    console.log(`[scheduler] YouTube posting queue scheduled every 5 minutes -> ${target}`);
  } catch (e) {
    console.warn(`[scheduler] Could not schedule the posting queue: ${(e as Error).message}`);
  } finally {
    await client.end();
  }
}
