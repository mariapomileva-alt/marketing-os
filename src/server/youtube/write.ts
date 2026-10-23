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

async function call<T>(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
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
