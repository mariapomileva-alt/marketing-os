import "server-only";
import type { Tx } from "@/server/db/client";
import { channelConnection, refreshTokenFor, threadsToken, youtubeConnection } from "./youtube-publish";
import { syncCalendar, type CalendarReaders } from "./calendar";
import { instagramMedia, instagramRefresh } from "@/server/instagram/api";
import { threadsMyPosts, threadsRefresh } from "@/server/threads/api";
import { accessToken, myUploads } from "@/server/youtube/write";

/** Readers for every platform this product has connected (official APIs, our own accounts only). */
export async function liveCalendarReaders(tx: Tx, productId: string): Promise<CalendarReaders> {
  const r: CalendarReaders = {};
  const ig = await channelConnection(tx, productId, "instagram");
  if (ig?.secret_id && ig.status === "connected") r.instagram = async () => instagramMedia(await threadsToken(tx, ig, { refresh: instagramRefresh }));
  const th = await channelConnection(tx, productId, "threads");
  if (th?.secret_id && th.status === "connected") r.threads = async () => threadsMyPosts(await threadsToken(tx, th, { refresh: threadsRefresh }));
  const yt = await youtubeConnection(tx, productId);
  if (yt?.secret_id && yt.status !== "revoked") r.youtube = async () => myUploads(await accessToken(await refreshTokenFor(yt.secret_id!)));
  return r;
}

export async function syncCalendarLive(tx: Tx, workspaceId: string, productId: string) {
  return syncCalendar(tx, workspaceId, productId, await liveCalendarReaders(tx, productId));
}
