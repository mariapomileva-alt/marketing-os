import { db, getProduct } from "@/server/context";
import { CHANNEL_REGISTRY } from "@/server/services/connections";
import { connectAiAction, connectChannelAction, revokeAiAction, revokeChannelAction, rotateAiAction } from "@/app/actions/system";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Section, Table } from "@/components/ui/layout";
import { DataFlag, Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";
import { disconnectYoutubeAction } from "@/app/actions/youtube";
import { publishingEnabled } from "@/server/services/youtube-publish";
import { oauthConfigured } from "@/server/youtube/write";
import { disconnectInstagramAction, disconnectThreadsAction, disconnectTiktokAction } from "@/app/actions/threads";
import { instagramOauthConfigured } from "@/server/instagram/api";
import { threadsOauthConfigured } from "@/server/threads/api";
import { tiktokDirectPostEnabled, tiktokOauthConfigured } from "@/server/tiktok/api";
import { connectAppStoreAction, disconnectAppStoreAction } from "@/app/actions/app-store";
import { getSiteSettings } from "@/server/services/traffic";

export const metadata = { title: "Connections" };

const YT_MESSAGES: Record<string, string> = {
  connected: "YouTube channel connected. Approved comments and replies will now be posted from it.",
  denied: "Google sign-in was cancelled. Nothing was connected.",
  bad_state: "The sign-in link expired or was opened in another browser. Press Connect YouTube channel again.",
  not_configured: "Google sign-in is not set up yet: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are missing in Vercel.",
};

export default async function ConnectionsPage({ params, searchParams }: PageProps<"/p/[product]/connections">) {
  const { product: slug } = await params;
  const ytParam = (await searchParams).yt;
  const thParam = (await searchParams).th;
  const TH: Record<string, string> = {
    connected: "Threads account connected. Approved replies and posts can now be published from it.",
    denied: "Threads sign-in was cancelled. Nothing was connected.",
    bad_state: "The sign-in link expired or was opened in another browser. Press Connect Threads again.",
    not_configured: "Threads sign-in is not set up yet: THREADS_APP_ID and THREADS_APP_SECRET are missing in Vercel.",
  };
  const igParam = (await searchParams).ig;
  const IG: Record<string, string> = {
    connected: "Instagram account connected. Comments under our reels are read and approved replies can be posted from it.",
    denied: "Instagram sign-in was cancelled. Nothing was connected.",
    bad_state: "The sign-in link expired or was opened in another browser. Press Connect Instagram again.",
    not_configured: "Instagram sign-in is not set up yet: INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are missing in Vercel.",
  };
  const ttParam = (await searchParams).tt;
  const TT: Record<string, string> = {
    connected: "TikTok account connected. Approved calm shorts ticked for TikTok will be sent to it at their time.",
    denied: "TikTok sign-in was cancelled. Nothing was connected.",
    bad_state: "The sign-in link expired or was opened in another browser. Press Connect TikTok again.",
    not_configured: "TikTok sign-in is not set up yet: TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are missing in Vercel.",
  };
  const tt = typeof ttParam === "string" ? (TT[ttParam] ?? (ttParam.startsWith("error:") ? `Could not connect TikTok: ${ttParam.slice(6)}` : null)) : null;
  const ig = typeof igParam === "string" ? (IG[igParam] ?? (igParam.startsWith("error:") ? `Could not connect Instagram: ${igParam.slice(6)}` : null)) : null;
  const th = typeof thParam === "string" ? (TH[thParam] ?? (thParam.startsWith("error:") ? `Could not connect Threads: ${thParam.slice(6)}` : null)) : null;
  const yt = typeof ytParam === "string" ? (YT_MESSAGES[ytParam] ?? (ytParam.startsWith("error:") ? `Could not connect: ${ytParam.slice(6)}` : null)) : null;
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => ({
    ai: await tx.query<{ id: string; provider: string; label: string; status: string; last_four: string | null; created_at: string; rotated_at: string | null; revoked_at: string | null; runs: number }>(
      `select c.id, c.provider, c.label, c.status, s.last_four, c.created_at::text, c.rotated_at::text, c.revoked_at::text,
              (select count(*)::int from agent_runs r where r.workspace_id = c.workspace_id and r.provider = c.provider) runs
         from ai_provider_connections c left join secrets s on s.id = c.secret_id where c.workspace_id = $1 order by c.created_at desc`,
      [ctx.workspaceId],
    ),
    channels: await tx.query<{ id: string; channel: string; adapter_kind: string; account_label: string; mode: string; status: string; paused_reason: string | null; last_error: string | null; created_at: string; revoked_at: string | null; pubs: number }>(
      `select c.id, c.channel, c.adapter_kind, c.account_label, c.mode, c.status, c.paused_reason, c.last_error, c.created_at::text, c.revoked_at::text,
              (select count(*)::int from publications p where p.connection_id = c.id) pubs
         from channel_connections c where c.product_id = $1 order by c.created_at desc`,
      [product.id],
    ),
    site: await getSiteSettings(tx, ctx.workspaceId, product.id),
    asc: await tx.maybeOne<{ app_name: string | null; app_apple_id: string; last_synced_at: string | null; last_data_date: string | null; last_error: string | null; last_four: string | null }>(
      `select a.app_name, a.app_apple_id, a.last_synced_at::text, a.last_data_date::text, a.last_error, s.last_four
         from app_store_sync a join channel_connections c on c.product_id = a.product_id and c.channel = 'app_store' and c.status = 'connected'
         left join secrets s on s.id = c.secret_id where a.product_id = $1`,
      [product.id],
    ),
  }));
  const appId = /id(\d{6,12})/.exec(d.site.app_store_url ?? "")?.[1] ?? "";
  const tone = (s: string) => (s === "connected" ? "green" : s === "revoked" ? "neutral" : "red") as "green" | "neutral" | "red";
  return (
    <>
      <PageHeader title="Connections" description="Keys and tokens are stored encrypted on the server, never in the browser or logs. Disconnecting deletes the secret; everything published and measured through it stays in history." />

      <Section title="AI providers (all products)" description="A connected Anthropic key is used for all drafts (Claude Sonnet 5.5); without it the labelled mock provider writes them. OpenAI keys can be stored but are not used yet. ChatGPT and Claude subscriptions do not include API access; API keys come from platform.claude.com or platform.openai.com.">
        <Table>
          <thead><tr><th>Provider</th><th>Key</th><th>Status</th><th>Connected</th><th>Runs recorded</th><th /></tr></thead>
          <tbody>
            <tr><td>Mock provider <DataFlag kind="mock" /></td><td>—</td><td>{d.ai.some((c) => c.provider === "anthropic" && c.status === "connected") ? <Status>Standby</Status> : <Status tone="green">Active</Status>}</td><td>Built in</td><td>—</td><td /></tr>
            {d.ai.map((c) => (
              <tr key={c.id}>
                <td>{c.provider === "anthropic" ? "Anthropic" : "OpenAI"}{c.label && c.label !== c.provider ? <span className="text-muted"> {c.label}</span> : null}</td>
                <td className="num">{c.last_four ? `…${c.last_four}` : "deleted"}</td>
                <td><Status tone={tone(c.status)}>{c.status === "connected" ? (c.provider === "anthropic" ? "Active: writes all drafts" : "Stored, not used yet") : c.status}</Status></td>
                <td className="num whitespace-nowrap">{formatDateTime(c.created_at)}{c.rotated_at ? <div className="text-[12px] text-muted">rotated {formatDateTime(c.rotated_at)}</div> : null}{c.revoked_at ? <div className="text-[12px] text-muted">disconnected {formatDateTime(c.revoked_at)}</div> : null}</td>
                <td className="num">{c.runs}</td>
                <td className="min-w-[220px]">
                  {c.status !== "revoked" ? (
                    <div className="flex flex-col gap-2">
                      <ActionForm action={rotateAiAction.bind(null, slug, c.id)} submitLabel="Rotate key" submitVariant="secondary" resetOnSuccess className="flex items-end gap-2">
                        <Input name="api_key" type="password" autoComplete="off" placeholder="New key" aria-label="New API key" className="h-7" />
                      </ActionForm>
                      <form action={revokeAiAction.bind(null, slug, c.id)}><Button size="sm" variant="danger">Disconnect</Button></form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <ActionForm action={connectAiAction.bind(null, slug)} submitLabel="Store key" resetOnSuccess className="mt-3 grid gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-[160px_1fr_200px_auto] sm:items-end">
          <Field label="Provider" htmlFor="ai-provider"><Select id="ai-provider" name="provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></Select></Field>
          <Field label="API key" htmlFor="ai-key"><Input id="ai-key" name="api_key" type="password" autoComplete="off" required /></Field>
          <Field label="Label" htmlFor="ai-label"><Input id="ai-label" name="label" /></Field>
        </ActionForm>
      </Section>

      <Section title="YouTube channel" description="Lets God of Marketing post the comments and replies you approve, as your channel. Nothing is ever posted without your approval; limits: a few per day, a gap between posts, daytime only.">
        {yt ? <p className="mb-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-[13px]">{yt}</p> : null}
        {(() => {
          const active = d.channels.find((x) => x.channel === "youtube" && x.status !== "revoked");
          if (active) {
            return (
              <div className="flex flex-wrap items-center gap-3">
                <Status tone={tone(active.status)}>{active.status === "connected" ? `Posting as ${active.account_label}` : `Paused: ${active.paused_reason ?? active.status}`}</Status>
                {!publishingEnabled() ? <span className="text-[13px] text-muted">Posting is still switched off on the server (YOUTUBE_PUBLISHING_ENABLED is not true), so drafts are copied by hand.</span> : null}
                <a href={`/api/youtube/oauth/start?product=${slug}`} className="text-[13px] underline">Reconnect</a>
                <form action={disconnectYoutubeAction.bind(null, slug)}><Button size="sm" variant="danger">Disconnect YouTube</Button></form>
              </div>
            );
          }
          return oauthConfigured() ? (
            <a href={`/api/youtube/oauth/start?product=${slug}`} className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-green px-4 text-[14px] font-medium text-white hover:bg-green-hover">Connect YouTube channel</a>
          ) : (
            <p className="text-[13px] text-muted">Google sign-in is not set up yet. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel (see README, “Posting to YouTube”), redeploy, then a Connect button appears here.</p>
          );
        })()}
      </Section>

      <Section title="Threads account" description="Lets God of Marketing publish the replies and posts you approve, as your Threads account, and read replies, likes and views. Nothing is posted without your approval.">
        {th ? <p className="mb-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-[13px]">{th}</p> : null}
        {(() => {
          const active = d.channels.find((x) => x.channel === "threads" && x.status !== "revoked" && x.adapter_kind === "official_api");
          if (active) {
            return (
              <div className="flex flex-wrap items-center gap-3">
                <Status tone={tone(active.status)}>{active.status === "connected" ? `Posting as ${active.account_label}` : `Paused: ${active.paused_reason ?? active.status}`}</Status>
                {!publishingEnabled("threads") ? <span className="text-[13px] text-muted">Posting is switched off on the server (THREADS_PUBLISHING_ENABLED is not true).</span> : null}
                <a href={`/api/threads/oauth/start?product=${slug}`} className="text-[13px] underline">Reconnect</a>
                <form action={disconnectThreadsAction.bind(null, slug)}><Button size="sm" variant="danger">Disconnect Threads</Button></form>
              </div>
            );
          }
          return threadsOauthConfigured() ? (
            <a href={`/api/threads/oauth/start?product=${slug}`} className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-green px-4 text-[14px] font-medium text-white hover:bg-green-hover">Connect Threads</a>
          ) : (
            <p className="text-[13px] text-muted">Threads sign-in is not set up yet. Add THREADS_APP_ID and THREADS_APP_SECRET in Vercel (see README, “Threads”), redeploy, then a Connect button appears here.</p>
          );
        })()}
      </Section>

      <Section title="Instagram account" description="Lets God of Marketing read comments under our own reels and post the replies you approve, as your Instagram professional account. Comments on other people's reels stay manual (Instagram does not allow it).">
        {ig ? <p className="mb-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-[13px]">{ig}</p> : null}
        {(() => {
          const active = d.channels.find((x) => x.channel === "instagram" && x.status !== "revoked" && x.adapter_kind === "official_api");
          if (active) {
            return (
              <div className="flex flex-wrap items-center gap-3">
                <Status tone={tone(active.status)}>{active.status === "connected" ? `Replying as ${active.account_label}` : `Paused: ${active.paused_reason ?? active.status}`}</Status>
                {!publishingEnabled("instagram") ? <span className="text-[13px] text-muted">Posting is switched off on the server (INSTAGRAM_PUBLISHING_ENABLED is not true).</span> : null}
                {active.last_error ? <span className="basis-full text-[13px] text-red">{active.last_error}</span> : null}
                <a href={`/api/instagram/oauth/start?product=${slug}`} className="text-[13px] underline">Reconnect</a>
                <form action={disconnectInstagramAction.bind(null, slug)}><Button size="sm" variant="danger">Disconnect Instagram</Button></form>
              </div>
            );
          }
          return instagramOauthConfigured() ? (
            <a href={`/api/instagram/oauth/start?product=${slug}`} className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-green px-4 text-[14px] font-medium text-white hover:bg-green-hover">Connect Instagram</a>
          ) : (
            <p className="text-[13px] text-muted">Instagram sign-in is not set up yet. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET in Vercel (see README, “Instagram”), redeploy, then a Connect button appears here.</p>
          );
        })()}
      </Section>

      <Section title="TikTok account" description="Lets God of Marketing send the calm shorts you approve to the team's TikTok account. Until TikTok has reviewed our app, each video arrives in your TikTok inbox as a draft and you post it from the TikTok app; after the review, it is posted at its time with the choices you made when approving.">
        {tt ? <p className="mb-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-[13px]">{tt}</p> : null}
        {(() => {
          const active = d.channels.find((x) => x.channel === "tiktok" && x.status !== "revoked" && x.adapter_kind === "official_api");
          if (active) {
            return (
              <div className="flex flex-wrap items-center gap-3">
                <Status tone={tone(active.status)}>{active.status === "connected" ? `Connected: ${active.account_label}` : `Paused: ${active.paused_reason ?? active.status}`}</Status>
                <span className="text-[13px] text-muted">{tiktokDirectPostEnabled() ? "Direct posting is on." : "Videos go to your TikTok inbox as drafts (direct posting starts after TikTok's review)."}</span>
                <a href={`/api/tiktok/oauth/start?product=${slug}`} className="text-[13px] underline">Reconnect</a>
                <form action={disconnectTiktokAction.bind(null, slug)}><Button size="sm" variant="danger">Disconnect TikTok</Button></form>
              </div>
            );
          }
          return tiktokOauthConfigured() ? (
            <a href={`/api/tiktok/oauth/start?product=${slug}`} className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-green px-4 text-[14px] font-medium text-white hover:bg-green-hover">Connect TikTok</a>
          ) : (
            <p className="text-[13px] text-muted">TikTok sign-in is not set up yet. In Vercel → Settings → Environment Variables add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (from TikTok for Developers → Back Publisher → Credentials), redeploy, then a Connect button appears here.</p>
          );
        })()}
      </Section>

      <Section title="App Store Connect (downloads analytics)" description="Read-only. Every morning God of Marketing reads Apple's downloads report: how many people downloaded the app, how they found it (search, browse, a website, another app) and which tagged link they came from (ct=web, ct=instagram, …). Nothing in App Store Connect is changed. The key is stored encrypted and is never shown again.">
        {d.asc ? (
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <Status tone={d.asc.last_error ? "red" : "green"}>{d.asc.app_name ?? `App ${d.asc.app_apple_id}`}</Status>
            <span className="text-muted">
              Key …{d.asc.last_four ?? "????"} · {d.asc.last_synced_at ? `read ${formatDateTime(d.asc.last_synced_at)}` : "not read yet"}
              {d.asc.last_data_date ? ` · data up to ${d.asc.last_data_date}` : " · Apple's first report arrives 1–2 days after connecting"}
            </span>
            {d.asc.last_error ? <span className="text-red">{d.asc.last_error}</span> : null}
            <form action={disconnectAppStoreAction.bind(null, slug)}><Button size="sm" variant="danger">Disconnect</Button></form>
          </div>
        ) : (
          <>
            <ol className="mb-3 list-decimal pl-5 text-[13px] text-muted">
              <li>App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → “+”.</li>
              <li>Name it “God of Marketing”, access <b>Admin</b> (Apple requires Admin once to start the reports; you can later replace it with a “Sales and Reports” key here).</li>
              <li>Download the .p8 file (Apple lets you download it only once) and copy the Key ID and the Issuer ID shown above the list.</li>
              <li>Fill in the form below. Do not send the key anywhere else.</li>
            </ol>
            <ActionForm action={connectAppStoreAction.bind(null, slug)} submitLabel="Check and connect" pendingLabel="Checking the key with Apple…" resetOnSuccess className="grid gap-3 md:grid-cols-2">
              <Field label="Issuer ID" htmlFor="asc-iss"><Input id="asc-iss" name="issuer_id" autoComplete="off" placeholder="57246542-96fe-1a63-e053-0824d011072a" /></Field>
              <Field label="Key ID" htmlFor="asc-kid"><Input id="asc-kid" name="key_id" autoComplete="off" placeholder="2X9R4HXF34" /></Field>
              <Field label="Key file (.p8)" htmlFor="asc-p8"><Input id="asc-p8" name="p8" type="file" accept=".p8,text/plain" className="h-auto py-1.5" /></Field>
              <Field label="App's Apple ID" htmlFor="asc-app" hint="The number in the App Store link"><Input id="asc-app" name="app_id" defaultValue={appId} placeholder="6811918141" /></Field>
            </ActionForm>
          </>
        )}
      </Section>

      <Section title={`Channels for ${product.name}`}>
        <Table>
          <thead><tr><th>Channel</th><th>What works in this build</th><th>Connection</th><th /></tr></thead>
          <tbody>{CHANNEL_REGISTRY.map((c) => {
            const conns = d.channels.filter((x) => x.channel === c.id);
            const active = conns.find((x) => x.status !== "revoked");
            return (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="max-w-[360px] text-muted">{c.status === "planned" ? <DataFlag kind="planned" /> : c.capabilities}{c.note ? <div className="text-[12px]">{c.note}</div> : null}</td>
                <td>
                  {!active && (c.id === "youtube" || c.id === "threads" || c.id === "instagram" || c.id === "tiktok") ? <span className="text-muted">Connect above</span> : active ? <><Status tone={tone(active.status)}>{active.account_label || "Connected"}</Status><div className="text-[12px] text-muted">{active.mode === "draft_only" ? "Draft only" : "Requires approval"}, {active.pubs} publications{active.paused_reason ? `, paused: ${active.paused_reason}` : ""}</div></> : <span className="text-muted">{c.status === "planned" ? "Not available yet" : "Not connected"}</span>}
                  {conns.filter((x) => x.status === "revoked").map((x) => <div key={x.id} className="text-[12px] text-faint">Disconnected {formatDateTime(x.revoked_at)}, {x.pubs} publications kept</div>)}
                </td>
                <td>{active && c.id !== "youtube" && !((c.id === "threads" || c.id === "instagram" || c.id === "tiktok") && active.adapter_kind === "official_api") ? <form action={revokeChannelAction.bind(null, slug, active.id)}><Button size="sm" variant="danger">Disconnect</Button></form> : null}</td>
              </tr>
            );
          })}</tbody>
        </Table>
        <ActionForm action={connectChannelAction.bind(null, slug)} submitLabel="Add channel" resetOnSuccess className="mt-3 grid gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-[180px_1fr_200px_auto] sm:items-end">
          <Field label="Channel" htmlFor="ch"><Select id="ch" name="channel">{CHANNEL_REGISTRY.filter((c) => c.status === "available" && c.adapter === "export").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Account" htmlFor="ch-acc" hint="e.g. @backapp. Used in the approval preview."><Input id="ch-acc" name="account_label" required /></Field>
          <Field label="Mode" htmlFor="ch-mode"><Select id="ch-mode" name="mode"><option value="requires_approval">Requires approval</option><option value="draft_only">Draft only</option></Select></Field>
        </ActionForm>
      </Section>
    </>
  );
}
