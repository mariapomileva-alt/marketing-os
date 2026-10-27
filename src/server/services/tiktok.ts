import { withContext, type Tx } from "@/server/db/client";
import { decryptSecret, encryptSecret, lastFour } from "@/server/security/crypto";
import type { CreatorInfo, PostOptions, PublishStatus, TikTokTokens } from "@/server/tiktok/api";
import { channelConnection } from "./youtube-publish";

/**
 * TikTok for calm shorts. The connection stores TikTok's access and refresh tokens together, encrypted (the access
 * token lives 24 hours, the refresh token a year). Approved shorts are uploaded when their time comes: as an inbox
 * draft until TikTok audits the app, then as a direct post with the choices the owner made at approval.
 */
export type TikTokConn = { id: string; secret_id: string | null; token_expires_at: string | null; external_account_id: string | null; status: string; account_label: string };

export async function saveTikTokConnection(tx: Tx, workspaceId: string, productId: string, label: string, t: TikTokTokens) {
  const old = await tx.maybeOne<{ id: string; secret_id: string | null }>("select id, secret_id from channel_connections where product_id = $1 and channel = 'tiktok' and status <> 'revoked'", [productId]);
  if (old) {
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [old.id]);
    if (old.secret_id) await tx.query("delete from secrets where id = $1", [old.secret_id]);
  }
  const payload = JSON.stringify(t);
  const enc = encryptSecret(payload);
  const sec = await tx.one<{ id: string }>(
    "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version, last_four) values ($1,'TikTok account tokens',$2,$3,$4,$5,$6) returning id",
    [workspaceId, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(t.accessToken)],
  );
  const limits = { daily_limit: 2, account_daily_cap: 2, min_gap_minutes: 60, author_cooldown_days: 0, active_hours: { start: 8, end: 23, tz: "Europe/Riga" } };
  return tx.one<{ id: string }>(
    `insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, external_account_id, mode, status, limits, secret_id, scopes, last_health_at, token_expires_at)
     values ($1,$2,'tiktok','official_api',$3,$4,'requires_approval','connected',$5,$6,$7, now(), $8) returning id`,
    [workspaceId, productId, label, t.openId, JSON.stringify(limits), sec.id, t.scopes, t.refreshExpiresAt],
  );
}

async function readTokens(secretId: string): Promise<TikTokTokens> {
  const row = await withContext({ userId: null, role: "service" }, (s) =>
    s.one<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number }>("select ciphertext, iv, auth_tag, key_version from secrets where id = $1", [secretId]),
  );
  return JSON.parse(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version })) as TikTokTokens;
}

/** A usable access token; refreshed (and the new pair stored) when it has less than ten minutes left. */
export async function tiktokAccess(tx: Tx, conn: TikTokConn, refresh: (refreshToken: string) => Promise<TikTokTokens>) {
  if (!conn.secret_id) throw new Error("The TikTok account is not connected.");
  const t = await readTokens(conn.secret_id);
  if (new Date(t.accessExpiresAt).getTime() - Date.now() > 10 * 60_000) return { token: t.accessToken, scopes: t.scopes };
  if (new Date(t.refreshExpiresAt).getTime() < Date.now()) throw new Error("The TikTok connection expired. Reconnect TikTok in Connections.");
  const n = await refresh(t.refreshToken);
  const enc = encryptSecret(JSON.stringify(n));
  await withContext({ userId: null, role: "service" }, (s) =>
    s.query("update secrets set ciphertext = $2, iv = $3, auth_tag = $4, key_version = $5, last_four = $6, rotated_at = now() where id = $1",
      [conn.secret_id, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(n.accessToken)]),
  );
  await tx.query("update channel_connections set token_expires_at = $2, last_health_at = now() where id = $1", [conn.id, n.refreshExpiresAt]);
  return { token: n.accessToken, scopes: n.scopes };
}

export const tiktokConnection = (tx: Tx, productId: string) => channelConnection(tx, productId, "tiktok") as Promise<TikTokConn | null>;

/** The caption we suggest; the owner can change it before approving. Calm, no promises, the emergency line. */
export function defaultTikTokCaption(title: string) {
  const first = title.replace(/ · 1 minute of calm$/, "").replace(/^\[MOCK\]\s*/, "").trim();
  return `${first}\n\nA minute of calm from the team behind Back panic app. Not a substitute for care: if you are in danger, call your local emergency number.\n\n#panicattack #anxiety #calm #breathe`;
}

export type TikTokChoice = Partial<Omit<PostOptions, "title">> & { mode: "inbox" | "direct" };

/** Checks the owner's direct-post choices against what TikTok allows for this account (creator info). */
export function validateDirectChoice(c: TikTokChoice, info: CreatorInfo | null) {
  if (c.mode !== "direct") return;
  if (!info) throw new Error("Could not read the TikTok account's posting options. Try again in a minute.");
  if (!c.privacy_level) throw new Error("Choose who can see the TikTok video.");
  if (!info.privacy_level_options.includes(c.privacy_level)) throw new Error("This privacy option is not available for the TikTok account.");
}

export interface TikTokDeps {
  access(): Promise<{ token: string; scopes: string[] }>;
  file(storagePath: string): Promise<Uint8Array>;
  upload(token: string, bytes: Uint8Array, mode: "inbox" | "direct", post: PostOptions | null): Promise<string>;
  status(token: string, publishId: string): Promise<PublishStatus>;
  directAllowed: boolean;
}

/**
 * Approved shorts for TikTok whose time has come (at most one upload per run, TikTok allows 6 calls a minute):
 * upload, then follow the status until TikTok has it in the inbox (owner finishes in the app) or published.
 */
export async function publishDueTikToks(tx: Tx, productId: string, deps: TikTokDeps) {
  const rows = await tx.query<{ id: string; workspace_id: string; title: string; tiktok_status: string; tiktok_caption: string | null; tiktok_options: TikTokChoice | null; tiktok_publish_id: string | null; storage_path: string | null }>(
    `select s.id, s.workspace_id, s.title, s.tiktok_status, s.tiktok_caption, s.tiktok_options, s.tiktok_publish_id, a.storage_path
       from calm_shorts s left join creative_assets a on a.id = s.preview_asset_id
      where s.product_id = $1 and 'tiktok' = any(s.targets) and s.status in ('scheduled', 'published') and s.publish_at <= now()
        and (s.tiktok_status in ('queued', 'processing') or (s.tiktok_status = 'sent_to_inbox' and s.publish_at > now() - interval '3 days'))
      order by (s.tiktok_status = 'queued'), s.publish_at limit 3`,
    [productId],
  );
  let uploaded = 0;
  const out: Array<{ id: string; result: string }> = [];
  for (const r of rows) {
    try {
      const { token } = await deps.access();
      if (r.tiktok_status === "queued") {
        if (uploaded) continue;
        if (!r.storage_path) throw new Error("The short's file is missing.");
        const choice = r.tiktok_options ?? { mode: "inbox" as const };
        const mode = choice.mode === "direct" && deps.directAllowed ? "direct" : "inbox";
        const post: PostOptions | null = mode === "direct"
          ? {
              title: r.tiktok_caption ?? defaultTikTokCaption(r.title), privacy_level: choice.privacy_level!,
              disable_comment: choice.disable_comment ?? true, disable_duet: choice.disable_duet ?? true, disable_stitch: choice.disable_stitch ?? true,
              brand_organic_toggle: choice.brand_organic_toggle ?? false, is_aigc: choice.is_aigc ?? true,
            }
          : null;
        const publishId = await deps.upload(token, await deps.file(r.storage_path), mode, post);
        uploaded++;
        await tx.query("update calm_shorts set tiktok_publish_id = $2, tiktok_status = 'processing', tiktok_error = null where id = $1", [r.id, publishId]);
        await tx.query(
          "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4)",
          [r.workspace_id, productId, `calm-tiktok:${r.id}`, mode === "direct" ? "TikTok video posted after approval" : "TikTok draft sent to the account's inbox after approval"],
        );
        out.push({ id: r.id, result: "uploaded" });
        continue;
      }
      const st = await deps.status(token, r.tiktok_publish_id!);
      if (st.status === "PROCESSING_UPLOAD" || st.status === "PROCESSING_DOWNLOAD") continue;
      if (st.status === "SEND_TO_USER_INBOX") {
        if (r.tiktok_status === "sent_to_inbox") continue; // waiting for the owner to finish it in the TikTok app
        await tx.query("update calm_shorts set tiktok_status = 'sent_to_inbox' where id = $1", [r.id]);
        out.push({ id: r.id, result: "in_inbox" });
      } else if (st.status === "PUBLISH_COMPLETE") {
        const postId = st.publicaly_available_post_id?.[0];
        await tx.query("update calm_shorts set tiktok_status = 'published', tiktok_post_id = $2 where id = $1", [r.id, postId != null ? String(postId) : null]);
        out.push({ id: r.id, result: "published" });
      } else {
        throw new Error(`TikTok could not take the video${st.fail_reason ? ` (${st.fail_reason})` : ""}.`);
      }
    } catch (e) {
      await tx.query("update calm_shorts set tiktok_status = 'failed', tiktok_error = $2 where id = $1", [r.id, (e as Error).message.slice(0, 300)]);
      out.push({ id: r.id, result: "failed" });
    }
  }
  return out;
}
