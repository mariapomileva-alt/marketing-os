import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { encryptionKey } from "@/server/security/crypto";

/**
 * Official YouTube Data API v3 calls that act as the team's channel, through Google OAuth 2.0
 * (scope youtube.force-ssl: post and read comments). Used only by publishing after approval.
 * Tokens never leave the server; errors never include them.
 */
export const YT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const API = "https://www.googleapis.com/youtube/v3";

export function oauthConfigured() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export class YouTubeWriteError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string) {
    super(message);
  }
}

// --- OAuth state: signed, short-lived, bound to a nonce cookie (CSRF) -----------------------------------------
function stateKey() {
  return createHmac("sha256", encryptionKey(1)).update("youtube-oauth-state").digest();
}
export function signState(payload: { productId: string; slug: string; nonce: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString("base64url");
  const mac = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function readState(state: string, nonce: string | undefined): { productId: string; slug: string } | null {
  const [body, mac] = state.split(".");
  if (!body || !mac || !nonce) return null;
  const expected = Buffer.from(createHmac("sha256", stateKey()).update(body).digest("base64url"));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { productId: string; slug: string; nonce: string; t: number };
  if (p.nonce !== nonce || Date.now() - p.t > 15 * 60_000) return null;
  return { productId: p.productId, slug: p.slug };
}
export const newNonce = () => randomBytes(16).toString("base64url");

export function authUrl(state: string, redirectUri: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: YT_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  }).toString();
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, ...params }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new YouTubeWriteError(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`, res.status, body.error ?? "oauth");
  return body;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!t.refresh_token) throw new YouTubeWriteError("Google did not return a long-lived token. Remove the app's access in your Google account and connect again.", 400, "no_refresh_token");
  return { accessToken: t.access_token!, refreshToken: t.refresh_token };
}

const tokenCache = new Map<string, { token: string; until: number }>();
export async function accessToken(refreshToken: string) {
  const key = createHmac("sha256", "cache").update(refreshToken).digest("hex");
  const hit = tokenCache.get(key);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  tokenCache.set(key, { token: t.access_token!, until: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token!;
}

export async function revokeToken(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST", cache: "no-store" }).catch(() => undefined);
}

async function call<T>(method: "GET" | "POST" | "PUT", path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } & T;
  if (!res.ok) {
    const reason = json.error?.errors?.[0]?.reason ?? "unknown";
    throw new YouTubeWriteError(`YouTube ${res.status} ${reason}: ${json.error?.message ?? "request failed"}`, res.status, reason);
  }
  return json;
}

export async function myChannel(token: string) {
  const r = await call<{ items?: Array<{ id: string; snippet?: { title?: string } }> }>("GET", "channels?part=snippet&mine=true", token);
  const c = r.items?.[0];
  if (!c) throw new YouTubeWriteError("This Google account has no YouTube channel. Sign in with the account that owns the Back channel.", 400, "no_channel");
  return { id: c.id, title: c.snippet?.title ?? "YouTube channel" };
}

/** A new top-level comment under a video. Returns the thread id (replies attach to it). */
export async function postComment(token: string, videoId: string, text: string) {
  const r = await call<{ id: string; snippet?: { topLevelComment?: { id?: string } } }>("POST", "commentThreads?part=snippet", token, {
    snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } },
  });
  return { threadId: r.id, commentId: r.snippet?.topLevelComment?.id ?? r.id };
}

/** A reply in an existing thread (YouTube threads are one level deep: every reply attaches to the top comment). */
export async function postReply(token: string, threadId: string, text: string) {
  const r = await call<{ id: string }>("POST", "comments?part=snippet", token, { snippet: { parentId: threadId, textOriginal: text } });
  return { commentId: r.id };
}

export interface ThreadReply {
  id: string;
  authorChannelId: string | null;
  authorName: string;
  text: string;
  publishedAt: string;
}

/** Public replies in a thread. Works with the read-only API key; nothing is posted. */
export async function listReplies(threadId: string, apiKey: string): Promise<ThreadReply[]> {
  const u = new URL(`${API}/comments`);
  u.search = new URLSearchParams({ part: "snippet", parentId: threadId, maxResults: "100", textFormat: "plainText", key: apiKey }).toString();
  const res = await fetch(u, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id: string; snippet?: { authorChannelId?: { value?: string }; authorDisplayName?: string; textOriginal?: string; textDisplay?: string; publishedAt?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new YouTubeWriteError(`YouTube ${res.status}: ${body.error?.message ?? "could not read replies"}`, res.status, "read");
  return (body.items ?? []).map((i) => ({
    id: i.id,
    authorChannelId: i.snippet?.authorChannelId?.value ?? null,
    authorName: i.snippet?.authorDisplayName ?? "Someone",
    text: i.snippet?.textOriginal ?? i.snippet?.textDisplay ?? "",
    publishedAt: i.snippet?.publishedAt ?? new Date().toISOString(),
  }));
}

export interface CommentStat {
  id: string;
  likeCount: number;
  replyCount: number | null; // only for top-level comments (threads)
}

/** Likes on our comments and replies, and reply counts on our threads. Read-only API key, 1 unit per 50 ids. */
export async function commentStats(commentIds: string[], threadIds: string[], apiKey: string): Promise<CommentStat[]> {
  const out = new Map<string, CommentStat>();
  const get = async (path: string, ids: string[]) => {
    for (let i = 0; i < ids.length; i += 50) {
      const u = new URL(`${API}/${path}`);
      u.search = new URLSearchParams({ part: "snippet", id: ids.slice(i, i + 50).join(","), maxResults: "50", key: apiKey }).toString();
      const res = await fetch(u, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { items?: Array<Record<string, unknown>>; error?: { message?: string } };
      if (!res.ok) throw new YouTubeWriteError(`YouTube ${res.status}: ${body.error?.message ?? "could not read comment stats"}`, res.status, "read");
      for (const item of body.items ?? []) {
        const snippet = item.snippet as { likeCount?: number; totalReplyCount?: number; topLevelComment?: { id?: string; snippet?: { likeCount?: number } } };
        if (path === "commentThreads") {
          const id = snippet.topLevelComment?.id ?? (item.id as string);
          out.set(id, { id, likeCount: snippet.topLevelComment?.snippet?.likeCount ?? 0, replyCount: snippet.totalReplyCount ?? 0 });
          if (item.id !== id) out.set(item.id as string, out.get(id)!);
        } else if (!out.has(item.id as string)) {
          out.set(item.id as string, { id: item.id as string, likeCount: snippet.likeCount ?? 0, replyCount: null });
        }
      }
    }
  };
  if (threadIds.length) await get("commentThreads", threadIds);
  const rest = commentIds.filter((id) => !out.has(id));
  if (rest.length) await get("comments", rest);
  return [...out.values()];
}

/**
 * Opens a resumable upload for a new PRIVATE video and returns the session URL. The URL only accepts the bytes of
 * this one video (no access token in it); the renderer PUTs the file there.
 */
export async function createUploadSession(token: string, meta: { title: string; description: string; tags: string[] }) {
  const res = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4" },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: "22", defaultLanguage: "en", defaultAudioLanguage: "en" },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    }),
    cache: "no-store",
  });
  const location = res.headers.get("location");
  if (!res.ok || !location) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new YouTubeWriteError(`YouTube upload session ${res.status}: ${json.error?.message ?? "no session"}`, res.status, "upload");
  }
  return location;
}

/** Schedules a private video (publishAt) or publishes it now. */
export async function scheduleVideo(token: string, videoId: string, publishAt: Date | null) {
  return call<{ id: string }>("PUT", "videos?part=status", token, {
    id: videoId,
    status: publishAt
      ? { privacyStatus: "private", publishAt: publishAt.toISOString(), selfDeclaredMadeForKids: false, containsSyntheticMedia: true }
      : { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  });
}

/** Takes a video off its schedule and keeps it private (used when a new version replaces it). Never deletes. */
export async function keepPrivate(token: string, videoId: string) {
  const cur = await call<{ items?: Array<{ status?: Record<string, unknown> }> }>("GET", `videos?part=status&id=${encodeURIComponent(videoId)}`, token);
  const status = cur.items?.[0]?.status;
  if (!status || status.privacyStatus !== "private") return;
  const keep = ["license", "embeddable", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia"];
  const next: Record<string, unknown> = Object.fromEntries(keep.filter((k) => k in status).map((k) => [k, status[k]]));
  next.privacyStatus = "private";
  return call<{ id: string }>("PUT", "videos?part=status", token, { id: videoId, status: next });
}

/**
 * Moves an already scheduled private video to another publish time and changes nothing else: the current status
 * (made-for-kids, synthetic-media label, licence, embedding) is read first and sent back with only publishAt changed.
 */
export async function moveScheduledVideo(token: string, videoId: string, publishAt: Date) {
  const cur = await call<{ items?: Array<{ status?: Record<string, unknown> }> }>("GET", `videos?part=status&id=${encodeURIComponent(videoId)}`, token);
  const status = cur.items?.[0]?.status;
  if (!status) throw new YouTubeWriteError("YouTube: the video was not found on the channel.", 404, "notFound");
  if (status.privacyStatus !== "private" || !status.publishAt) throw new YouTubeWriteError("YouTube: the video is no longer scheduled.", 409, "notScheduled");
  const keep = ["privacyStatus", "license", "embeddable", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia"];
  const next: Record<string, unknown> = Object.fromEntries(keep.filter((k) => k in status).map((k) => [k, status[k]]));
  next.publishAt = publishAt.toISOString();
  return call<{ id: string }>("PUT", "videos?part=status", token, { id: videoId, status: next });
}

export interface OwnVideo { id: string; title: string; publishedAt: string | null; publishAt: string | null; privacy: string; thumbnail: string | null; seconds: number | null }

/** Our channel's latest uploads with their privacy and scheduled time (youtube.force-ssl covers reading our own videos). */
export async function myUploads(token: string, max = 50): Promise<OwnVideo[]> {
  const ch = await call<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>("GET", "channels?part=contentDetails&mine=true", token);
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  const pl = await call<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>("GET", `playlistItems?part=contentDetails&maxResults=${max}&playlistId=${uploads}`, token);
  const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => Boolean(x));
  if (!ids.length) return [];
  const v = await call<{ items?: Array<{ id: string; snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> }; status?: { privacyStatus?: string; publishAt?: string }; contentDetails?: { duration?: string } }> }>(
    "GET", `videos?part=snippet,status,contentDetails&id=${ids.join(",")}`, token);
  const secs = (d?: string) => {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? "");
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
  };
  return (v.items ?? []).map((x) => ({
    id: x.id, title: x.snippet?.title ?? "", publishedAt: x.snippet?.publishedAt ?? null, publishAt: x.status?.publishAt ?? null,
    privacy: x.status?.privacyStatus ?? "unknown", thumbnail: x.snippet?.thumbnails?.medium?.url ?? x.snippet?.thumbnails?.default?.url ?? null, seconds: secs(x.contentDetails?.duration),
  }));
}
