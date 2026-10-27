import type { Tx } from "@/server/db/client";
import { encryptSecret, lastFour } from "@/server/security/crypto";

/** Channel registry: what each channel can do in this build. Planned channels can be seen but not connected. */
export const CHANNEL_REGISTRY: Array<{ id: string; name: string; status: "available" | "planned"; adapter: "export" | "official_api"; capabilities: string; note?: string }> = [
  { id: "instagram", name: "Instagram", status: "available", adapter: "official_api", capabilities: "Comments under our reels read and answered after your approval (official API); posts exported for manual posting" },
  { id: "facebook", name: "Facebook Page", status: "available", adapter: "export", capabilities: "Export for manual posting; metrics by CSV or manual entry" },
  { id: "threads", name: "Threads", status: "available", adapter: "official_api", capabilities: "Posts and replies published after your approval, replies and insights read back (official API, Meta sign-in)" },
  { id: "website", name: "Website", status: "available", adapter: "export", capabilities: "Landing pages for tracking links; article export" },
  { id: "meta_ads", name: "Meta Ads", status: "available", adapter: "export", capabilities: "Report import by CSV", note: "Read-only API sync in v0.2; changes with approval in v0.4." },
  { id: "google_ads", name: "Google Ads", status: "available", adapter: "export", capabilities: "Report import by CSV", note: "Read-only API sync in v0.2; changes with approval in v0.4." },
  { id: "youtube", name: "YouTube", status: "available", adapter: "official_api", capabilities: "Comments and replies from your channel, each one after your approval (official API, Google sign-in)" },
  { id: "tiktok", name: "TikTok", status: "available", adapter: "official_api", capabilities: "Approved calm shorts are uploaded to our TikTok account: to the TikTok inbox as drafts until TikTok audits the app, then posted directly (official API)" },
  { id: "x", name: "X / Twitter", status: "planned", adapter: "official_api", capabilities: "—" },
  { id: "linkedin", name: "LinkedIn", status: "planned", adapter: "official_api", capabilities: "—" },
  { id: "snapchat", name: "Snapchat", status: "planned", adapter: "official_api", capabilities: "—" },
  { id: "pinterest", name: "Pinterest", status: "planned", adapter: "official_api", capabilities: "—" },
  { id: "blog", name: "Blog / SEO", status: "planned", adapter: "official_api", capabilities: "—" },
  { id: "email", name: "Email / newsletter", status: "planned", adapter: "official_api", capabilities: "—" },
];

export async function connectAiProvider(tx: Tx, workspaceId: string, provider: "anthropic" | "openai", apiKey: string, label: string) {
  const key = apiKey.trim();
  if (key.length < 20) throw new Error("This does not look like an API key.");
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) throw new Error("Anthropic API keys start with sk-ant-.");
  if (provider === "openai" && !key.startsWith("sk-")) throw new Error("OpenAI API keys start with sk-.");
  const existing = await tx.maybeOne<{ id: string }>("select id from ai_provider_connections where workspace_id = $1 and provider = $2 and status <> 'revoked'", [workspaceId, provider]);
  if (existing) throw new Error("This provider is already connected. Rotate the key instead.");
  const enc = encryptSecret(key);
  const s = await tx.one<{ id: string }>(
    "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version, last_four) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [workspaceId, `${provider} API key`, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(key)],
  );
  return tx.one<{ id: string }>("insert into ai_provider_connections (workspace_id, provider, label, secret_id) values ($1,$2,$3,$4) returning id", [workspaceId, provider, label || provider, s.id]);
}

export async function rotateAiKey(tx: Tx, workspaceId: string, connectionId: string, apiKey: string) {
  const c = await tx.one<{ secret_id: string | null; provider: string }>("select secret_id, provider from ai_provider_connections where id = $1 and workspace_id = $2 and status <> 'revoked'", [connectionId, workspaceId]);
  const enc = encryptSecret(apiKey.trim());
  const s = await tx.one<{ id: string }>(
    "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version, last_four, rotated_at) values ($1,$2,$3,$4,$5,$6,$7, now()) returning id",
    [workspaceId, `${c.provider} API key`, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(apiKey.trim())],
  );
  await tx.query("update ai_provider_connections set secret_id = $2, rotated_at = now() where id = $1", [connectionId, s.id]);
  if (c.secret_id) await tx.query("delete from secrets where id = $1", [c.secret_id]);
}

/** Disconnect: the encrypted key is deleted; the connection row and every run that used it stay in history. */
export async function revokeAiProvider(tx: Tx, workspaceId: string, connectionId: string) {
  const c = await tx.one<{ secret_id: string | null }>("select secret_id from ai_provider_connections where id = $1 and workspace_id = $2", [connectionId, workspaceId]);
  await tx.query("update ai_provider_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [connectionId]);
  if (c.secret_id) await tx.query("delete from secrets where id = $1", [c.secret_id]);
}

export async function connectChannel(tx: Tx, workspaceId: string, productId: string, channel: string, accountLabel: string, mode: "draft_only" | "requires_approval") {
  const entry = CHANNEL_REGISTRY.find((c) => c.id === channel);
  if (!entry || entry.status !== "available") throw new Error("This channel is planned and cannot be connected yet.");
  const existing = await tx.maybeOne<{ id: string }>("select id from channel_connections where product_id = $1 and channel = $2 and status <> 'revoked'", [productId, channel]);
  if (existing) throw new Error("This channel is already connected for this product.");
  return tx.one<{ id: string }>(
    "insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, mode, last_health_at) values ($1,$2,$3,'export',$4,$5, now()) returning id",
    [workspaceId, productId, channel, accountLabel, mode],
  );
}

/** Disconnect a channel: publications, actions and metrics keep pointing at the revoked connection. */
export async function revokeChannel(tx: Tx, productId: string, connectionId: string) {
  const c = await tx.one<{ secret_id: string | null }>("select secret_id from channel_connections where id = $1 and product_id = $2", [connectionId, productId]);
  await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [connectionId]);
  if (c.secret_id) await tx.query("delete from secrets where id = $1", [c.secret_id]);
}
