import "server-only";
import type { Tx } from "@/server/db/client";
import { refreshTokenFor, youtubeConnection } from "./youtube-publish";
import { accessToken, moveScheduledVideo } from "@/server/youtube/write";

/** The YouTube mover for mixing shorts (null when YouTube is not connected). */
export async function youtubeMover(tx: Tx, productId: string) {
  const conn = await youtubeConnection(tx, productId);
  if (!conn?.secret_id || conn.status === "revoked") return null;
  const token = await accessToken(await refreshTokenFor(conn.secret_id));
  return { move: async (id: string, at: Date) => void (await moveScheduledVideo(token, id, at)) };
}
