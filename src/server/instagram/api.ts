import "server-only";

/**
 * Instagram API with Instagram Login (graph.instagram.com), as the team's professional account. Used only for our
 * own media: reading comments under our reels, posting approved replies to them, and publishing approved Reels. The API does not allow
 * commenting on other accounts' media; that stays manual. Tokens stay on the server; errors never include them.
 */
const GRAPH = "https://graph.instagram.com";
const API = `${GRAPH}/v23.0`;
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_manage_comments", "instagram_business_content_publish"];

export function instagramOauthConfigured() {
  return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
}

type Fetch = typeof fetch;

async function call<T>(f: Fetch, method: "GET" | "POST", url: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  const res = method === "GET"
    ? await f(`${url}${url.includes("?") ? "&" : "?"}${body.toString()}`, { cache: "no-store" })
    : await f(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; type?: string }; error_message?: string } & T;
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new Error(`Instagram ${res.status} ${e.type ?? ""} ${e.code ?? ""}: ${e.message ?? json.error_message ?? "request failed"}`.replace(/\s+/g, " "));
  }
  return json;
}

export function instagramAuthUrl(state: string, redirectUri: string) {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.search = new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID!, redirect_uri: redirectUri, response_type: "code", scope: INSTAGRAM_SCOPES.join(","), state }).toString();
  return u.toString();
}

/** Code → short-lived token → long-lived token (60 days). */
export async function instagramExchangeCode(code: string, redirectUri: string, f: Fetch = fetch) {
  const short = await call<{ data?: Array<{ access_token: string; user_id: string | number }>; access_token?: string; user_id?: string | number }>(f, "POST", "https://api.instagram.com/oauth/access_token", {
    client_id: process.env.INSTAGRAM_APP_ID!, client_secret: process.env.INSTAGRAM_APP_SECRET!, grant_type: "authorization_code", redirect_uri: redirectUri, code,
  });
  const s = short.data?.[0] ?? { access_token: short.access_token!, user_id: short.user_id! };
  const long = await call<{ access_token: string; expires_in: number }>(f, "GET", `${GRAPH}/access_token`, {
    grant_type: "ig_exchange_token", client_secret: process.env.INSTAGRAM_APP_SECRET!, access_token: s.access_token,
  });
  return { accessToken: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000), userId: String(s.user_id) };
}

export async function instagramRefresh(token: string, f: Fetch = fetch) {
  const r = await call<{ access_token: string; expires_in: number }>(f, "GET", `${GRAPH}/refresh_access_token`, { grant_type: "ig_refresh_token", access_token: token });
  return { accessToken: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
}

export async function instagramMe(token: string, f: Fetch = fetch) {
  return call<{ user_id?: string; id: string; username: string }>(f, "GET", `${API}/me`, { fields: "user_id,username", access_token: token });
}

export interface IgMedia {
  id: string;
  caption: string;
  permalink: string | null;
  timestamp: string | null;
  comments_count: number;
  like_count: number;
  media_product_type: string | null;
}

export async function instagramMedia(token: string, f: Fetch = fetch): Promise<IgMedia[]> {
  const r = await call<{ data?: Array<Record<string, unknown>> }>(f, "GET", `${API}/me/media`, {
    fields: "id,caption,media_type,media_product_type,permalink,timestamp,comments_count,like_count", limit: "25", access_token: token,
  });
  return (r.data ?? []).map((m) => ({
    id: String(m.id), caption: String(m.caption ?? ""), permalink: (m.permalink as string) ?? null, timestamp: (m.timestamp as string) ?? null,
    comments_count: Number(m.comments_count ?? 0), like_count: Number(m.like_count ?? 0), media_product_type: (m.media_product_type as string) ?? null,
  }));
}

export interface IgComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
  like_count: number | null;
  replies: Array<{ id: string; text: string; username: string | null; timestamp: string | null }>;
}

export async function instagramComments(token: string, mediaId: string, f: Fetch = fetch): Promise<IgComment[]> {
  const r = await call<{ data?: Array<Record<string, unknown>> }>(f, "GET", `${API}/${mediaId}/comments`, {
    fields: "id,text,username,timestamp,like_count,replies{id,text,username,timestamp}", limit: "50", access_token: token,
  });
  return (r.data ?? []).map((c) => ({
    id: String(c.id), text: String(c.text ?? ""), username: (c.username as string) ?? null, timestamp: (c.timestamp as string) ?? null,
    like_count: c.like_count === undefined ? null : Number(c.like_count),
    replies: (((c.replies as { data?: Array<Record<string, unknown>> } | undefined)?.data) ?? []).map((x) => ({
      id: String(x.id), text: String(x.text ?? ""), username: (x.username as string) ?? null, timestamp: (x.timestamp as string) ?? null,
    })),
  }));
}

/** Instagram threads are one level deep: a reply always attaches to the top-level comment. */
export async function instagramReply(token: string, commentId: string, message: string, f: Fetch = fetch) {
  return call<{ id: string }>(f, "POST", `${API}/${commentId}/replies`, { message, access_token: token });
}

/** Reels publishing (our own account): a container from a video URL, processed by Instagram, then published. */
export async function instagramCreateReel(token: string, igUserId: string, videoUrl: string, caption: string, f: Fetch = fetch) {
  return (await call<{ id: string }>(f, "POST", `${API}/${igUserId}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", access_token: token })).id;
}
export async function instagramContainerStatus(token: string, containerId: string, f: Fetch = fetch) {
  return (await call<{ status_code?: string }>(f, "GET", `${API}/${containerId}`, { fields: "status_code", access_token: token })).status_code ?? "IN_PROGRESS";
}
export async function instagramPublish(token: string, igUserId: string, containerId: string, f: Fetch = fetch) {
  return (await call<{ id: string }>(f, "POST", `${API}/${igUserId}/media_publish`, { creation_id: containerId, access_token: token })).id;
}
