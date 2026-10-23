import "server-only";

/**
 * Official Threads API (graph.threads.net) as the team's Threads account, through Meta OAuth. Used for: publishing
 * approved posts and replies, reading replies and insights, keyword search. Tokens stay on the server; errors never
 * include them. Keyword search returns only our own posts until Meta approves threads_keyword_search for the app.
 */
const GRAPH = "https://graph.threads.net";
const API = `${GRAPH}/v1.0`;
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_replies", "threads_read_replies", "threads_keyword_search", "threads_manage_insights"];

export function threadsOauthConfigured() {
  return Boolean(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET);
}

export class ThreadsError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function call<T>(f: Fetch, method: "GET" | "POST", url: string, params: Record<string, string>): Promise<T> {
  const u = new URL(url);
  const body = new URLSearchParams(params);
  const res = method === "GET"
    ? await f(`${u.toString()}${u.search ? "&" : "?"}${body.toString()}`, { cache: "no-store" })
    : await f(u, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number; type?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new ThreadsError(`Threads ${res.status} ${e.type ?? ""} ${e.code ?? ""}: ${e.message ?? "request failed"}`.replace(/\s+/g, " "), res.status, String(e.code ?? res.status));
  }
  return json;
}

export function threadsAuthUrl(state: string, redirectUri: string) {
  const u = new URL("https://threads.net/oauth/authorize");
  u.search = new URLSearchParams({ client_id: process.env.THREADS_APP_ID!, redirect_uri: redirectUri, scope: THREADS_SCOPES.join(","), response_type: "code", state }).toString();
  return u.toString();
}

/** Code → short-lived token → long-lived token (60 days). */
export async function threadsExchangeCode(code: string, redirectUri: string, f: Fetch = fetch) {
  const short = await call<{ access_token: string; user_id: string | number }>(f, "POST", `${GRAPH}/oauth/access_token`, {
    client_id: process.env.THREADS_APP_ID!, client_secret: process.env.THREADS_APP_SECRET!, grant_type: "authorization_code", redirect_uri: redirectUri, code,
  });
  const long = await call<{ access_token: string; expires_in: number }>(f, "GET", `${GRAPH}/access_token`, {
    grant_type: "th_exchange_token", client_secret: process.env.THREADS_APP_SECRET!, access_token: short.access_token,
  });
  return { accessToken: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000), userId: String(short.user_id) };
}

export async function threadsRefresh(token: string, f: Fetch = fetch) {
  const r = await call<{ access_token: string; expires_in: number }>(f, "GET", `${GRAPH}/refresh_access_token`, { grant_type: "th_refresh_token", access_token: token });
  return { accessToken: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
}

export async function threadsMe(token: string, f: Fetch = fetch) {
  return call<{ id: string; username: string }>(f, "GET", `${API}/me`, { fields: "id,username", access_token: token });
}

/** Creates and publishes a text post, or a reply when replyToId is given. Returns the media id and permalink. */
export async function threadsPublish(token: string, userId: string, text: string, replyToId: string | null, f: Fetch = fetch) {
  const container = await call<{ id: string }>(f, "POST", `${API}/${userId}/threads`, {
    media_type: "TEXT", text, ...(replyToId ? { reply_to_id: replyToId } : {}), access_token: token,
  });
  let published: { id: string } | null = null;
  for (let attempt = 0; attempt < 4 && !published; attempt++) {
    try {
      published = await call<{ id: string }>(f, "POST", `${API}/${userId}/threads_publish`, { creation_id: container.id, access_token: token });
    } catch (e) {
      // The container may need a moment before it can be published.
      if (attempt === 3 || !/not ready|in progress|24|4279009/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const meta = await call<{ permalink?: string }>(f, "GET", `${API}/${published!.id}`, { fields: "permalink", access_token: token }).catch(() => ({ permalink: undefined }));
  return { id: published!.id, permalink: meta.permalink ?? null };
}

export interface ThreadsPost {
  id: string;
  text: string;
  username: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export async function threadsKeywordSearch(token: string, q: string, f: Fetch = fetch): Promise<ThreadsPost[]> {
  const r = await call<{ data?: Array<Record<string, string | undefined>> }>(f, "GET", `${API}/keyword_search`, {
    q, search_type: "RECENT", fields: "id,text,media_type,permalink,timestamp,username", access_token: token,
  });
  return (r.data ?? []).filter((p) => p.text).map((p) => ({ id: p.id!, text: p.text ?? "", username: p.username ?? null, permalink: p.permalink ?? null, timestamp: p.timestamp ?? null }));
}

/** Replies under a post or reply of ours (one level: direct replies). */
export async function threadsReplies(token: string, mediaId: string, f: Fetch = fetch): Promise<ThreadsPost[]> {
  const r = await call<{ data?: Array<Record<string, string | undefined>> }>(f, "GET", `${API}/${mediaId}/replies`, {
    fields: "id,text,username,permalink,timestamp", reverse: "false", access_token: token,
  });
  return (r.data ?? []).filter((p) => p.text).map((p) => ({ id: p.id!, text: p.text ?? "", username: p.username ?? null, permalink: p.permalink ?? null, timestamp: p.timestamp ?? null }));
}

export interface ThreadsInsights { views: number; likes: number; replies: number; reposts: number; quotes: number }

export async function threadsInsights(token: string, mediaId: string, f: Fetch = fetch): Promise<ThreadsInsights> {
  const r = await call<{ data?: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>(f, "GET", `${API}/${mediaId}/insights`, {
    metric: "views,likes,replies,reposts,quotes", access_token: token,
  });
  const get = (n: string) => {
    const m = (r.data ?? []).find((d) => d.name === n);
    return m?.total_value?.value ?? m?.values?.[0]?.value ?? 0;
  };
  return { views: get("views"), likes: get("likes"), replies: get("replies"), reposts: get("reposts"), quotes: get("quotes") };
}
