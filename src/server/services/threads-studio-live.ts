import "server-only";
import type { Tx } from "@/server/db/client";
import { channelConnection, threadsToken } from "./youtube-publish";
import { refreshStudioStats } from "./threads-studio";
import { threadsInsights, threadsRefresh } from "@/server/threads/api";

/** Reads reactions for our studio posts with the connected Threads account. No-op when Threads is not connected. */
export async function refreshStudioStatsLive(tx: Tx, productId: string, limit = 30) {
  const conn = await channelConnection(tx, productId, "threads");
  if (!conn?.secret_id || conn.status === "revoked") return { checked: 0, connected: false };
  const token = await threadsToken(tx, conn, { refresh: threadsRefresh });
  return { ...(await refreshStudioStats(tx, productId, (id) => threadsInsights(token, id), limit)), connected: true };
}
