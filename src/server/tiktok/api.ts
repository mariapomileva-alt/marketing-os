import "server-only";

/**
 * TikTok for Developers (open.tiktokapis.com), as the team's own TikTok account through Login Kit.
 * Used only to upload approved calm shorts: to the inbox as a draft (video.upload) or, after TikTok's audit, as a
 * direct post (video.publish). Tokens stay on the server; errors never include them.
 */
const API = "https://open.tiktokapis.com/v2";
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"];
type Fetch = typeof fetch;

export function tiktokOauthConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

/** Direct Post only after TikTok has audited the app (until then posts would be private-only). */
export function tiktokDirectPostEnabled() {
  return process.env.TIKTOK_DIRECT_POST === "true";
}

export class TikTokError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } | string; error_description?: string } & T;
  const err = json.error;
  const code = typeof err === "string" ? err : err?.code;
  if (!res.ok || (code && code !== "ok")) {
    const message = typeof err === "string" ? json.error_description ?? err : err?.message ?? "request failed";
    throw new TikTokError(`TikTok ${res.status} ${code ?? ""}: ${message}`.replace(/\s+/g, " ").trim(), res.status, String(code ?? res.status));
  }
  return json;
}

export function tiktokAuthUrl(state: string, redirectUri: string) {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.search = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, response_type: "code", scope: TIKTOK_SCOPES.join(","), redirect_uri: redirectUri, state }).toString();
  return u.toString();
}

export interface TikTokTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  openId: string;
  scopes: string[];
}

async function token(params: Record<string, string>, f: Fetch): Promise<TikTokTokens> {
  const res = await f(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, ...params }),
    cache: "no-store",
  });
  const j = await readJson<{ access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; open_id: string; scope: string }>(res);
  const now = Date.now();
  return {
    accessToken: j.access_token, accessExpiresAt: new Date(now + j.expires_in * 1000).toISOString(),
    refreshToken: j.refresh_token, refreshExpiresAt: new Date(now + j.refresh_expires_in * 1000).toISOString(),
    openId: j.open_id, scopes: (j.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export const tiktokExchangeCode = (code: string, redirectUri: string, f: Fetch = fetch) =>
  token({ code, grant_type: "authorization_code", redirect_uri: redirectUri }, f);
export const tiktokRefresh = (refreshToken: string, f: Fetch = fetch) => token({ grant_type: "refresh_token", refresh_token: refreshToken }, f);

export async function tiktokRevoke(accessToken: string, f: Fetch = fetch) {
  await f(`${API}/oauth/revoke/`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, token: accessToken }),
  });
}

async function call<T>(f: Fetch, accessToken: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await f(`${API}${path}`, {
    method, cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json; charset=UTF-8" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await readJson<{ data: T }>(res)).data;
}

export async function tiktokMe(accessToken: string, f: Fetch = fetch) {
  const d = await call<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(f, accessToken, "GET", "/user/info/?fields=open_id,display_name,avatar_url");
  return d.user;
}

export interface CreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  creator_avatar_url?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}
export const tiktokCreatorInfo = (accessToken: string, f: Fetch = fetch) => call<CreatorInfo>(f, accessToken, "POST", "/post/publish/creator_info/query/", {});

/** Chunking per TikTok's media transfer rules: one chunk up to 64 MB, otherwise 10 MB chunks, the last absorbs the rest. */
export function chunkPlan(size: number) {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

export interface PostOptions {
  title: string;
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  brand_organic_toggle: boolean;
  is_aigc: boolean;
}

/** Starts an upload (inbox draft, or direct post with options) and sends the file. Returns the publish id. */
export async function tiktokUpload(accessToken: string, bytes: Uint8Array, mode: "inbox" | "direct", post: PostOptions | null, f: Fetch = fetch) {
  const plan = chunkPlan(bytes.byteLength);
  const source_info = { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: plan.chunkSize, total_chunk_count: plan.count };
  const init = mode === "direct"
    ? await call<{ publish_id: string; upload_url: string }>(f, accessToken, "POST", "/post/publish/video/init/", { post_info: { ...post, brand_content_toggle: false }, source_info })
    : await call<{ publish_id: string; upload_url: string }>(f, accessToken, "POST", "/post/publish/inbox/video/init/", { source_info });
  for (let i = 0; i < plan.count; i++) {
    const start = i * plan.chunkSize;
    const end = i === plan.count - 1 ? bytes.byteLength : start + plan.chunkSize;
    const res = await f(init.upload_url, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-length": String(end - start), "content-range": `bytes ${start}-${end - 1}/${bytes.byteLength}` },
      body: bytes.slice(start, end),
    });
    if (!res.ok) throw new TikTokError(`TikTok upload ${res.status} on chunk ${i + 1}/${plan.count}`, res.status, "upload_failed");
  }
  return init.publish_id;
}

export interface PublishStatus {
  status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED" | string;
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
}
export const tiktokStatus = (accessToken: string, publishId: string, f: Fetch = fetch) =>
  call<PublishStatus>(f, accessToken, "POST", "/post/publish/status/fetch/", { publish_id: publishId });
