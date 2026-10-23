import { saveSiteSettingsAction } from "@/app/actions/traffic";
import { CopyButton } from "@/components/content/copy-button";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, Section, Table } from "@/components/ui/layout";
import { appStoreCampaignUrl, LINK_PLACEMENTS, SOURCE_LABEL, taggedUrl, type Source } from "@/domain/traffic";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import type { SiteSettings, SourceRow } from "@/server/services/traffic";

type Traffic = { rows: SourceRow[]; campaigns: Array<{ campaign: string; source: string; visits: number; app_store_clicks: number }>; first: string | null };

export function WebsiteTraffic({ traffic, period }: { traffic: Traffic; period: string }) {
  const total = traffic.rows.reduce((n, r) => n + r.visits, 0);
  const clicks = traffic.rows.reduce((n, r) => n + r.app_store_clicks, 0);
  const max = Math.max(1, ...traffic.rows.map((r) => r.visits));
  return (
    <Section
      title="Website visitors by source"
      description={`Where people came from to the site, ${period}, and how many of them then pressed the App Store button. Counted by the site counter (no cookies); people who block scripts are not counted.`}
    >
      {traffic.rows.length ? (
        <>
          <p className="mb-3 text-[13.5px]">
            <span className="num font-semibold">{formatNumber(total)}</span> visits, <span className="num font-semibold">{formatNumber(clicks)}</span> App Store clicks
            {total ? <span className="text-muted"> ({formatPercent(clicks / total)} of visits)</span> : null}
          </p>
          <Table>
            <thead><tr><th>Source</th><th className="w-[38%]" aria-label="Share of visits" /><th className="text-right">Visits</th><th className="text-right">Visitors</th><th className="text-right">App Store clicks</th><th className="text-right">Click rate</th></tr></thead>
            <tbody>
              {traffic.rows.map((r) => (
                <tr key={r.source}>
                  <td className="whitespace-nowrap">{SOURCE_LABEL[r.source as Source] ?? r.source}</td>
                  <td><div className="h-2 rounded-full bg-green" style={{ width: `${Math.max(2, (r.visits / max) * 100)}%` }} /></td>
                  <td className="num text-right">{formatNumber(r.visits)}</td>
                  <td className="num text-right">{formatNumber(r.visitors)}</td>
                  <td className="num text-right">{formatNumber(r.app_store_clicks)}</td>
                  <td className="num text-right">{r.visits ? formatPercent(r.app_store_clicks / r.visits) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {traffic.campaigns.length ? (
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer text-muted">By tagged link ({traffic.campaigns.length})</summary>
              <Table>
                <thead><tr><th>Link</th><th>Source</th><th className="text-right">Visits</th><th className="text-right">App Store clicks</th></tr></thead>
                <tbody>{traffic.campaigns.map((c) => <tr key={`${c.campaign}-${c.source}`}><td>{c.campaign.replaceAll("_", " ")}</td><td>{SOURCE_LABEL[c.source as Source] ?? c.source}</td><td className="num text-right">{c.visits}</td><td className="num text-right">{c.app_store_clicks}</td></tr>)}</tbody>
              </Table>
            </details>
          ) : null}
        </>
      ) : (
        <EmptyState title={traffic.first ? "No visits in this period" : "The counter has not reported any visits yet"}>
          {traffic.first ? `First visit recorded ${formatDateTime(traffic.first)}.` : "Add the counter to the site (see “Set up the website counter” below). Visits appear here within a minute."}
        </EmptyState>
      )}
      <p className="mt-2 text-[12px] text-muted">Installs per source are counted by Apple, not here: App Store Connect → Analytics → Acquisition → Campaigns, for the links below.</p>
    </Section>
  );
}

export function YoutubeCommentStats({ totals, top }: {
  totals: { posted: number; replies_posted: number; likes: number; replies_received: number; conversations: number };
  top: Array<{ id: string; text: string; like_count: number | null; reply_count: number | null; subject: string | null; thread_url: string | null; occurred_at: string }>;
}) {
  const metric = (label: string, value: number, note?: string) => (
    <div className="min-w-[120px] px-4 py-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[20px] font-semibold tracking-tight">{formatNumber(value)}</dd>
      {note ? <dd className="text-[11.5px] text-faint">{note}</dd> : null}
    </div>
  );
  return (
    <Section title="YouTube comments" description="Our comments and replies posted from the channel. Likes and replies are read from YouTube every morning and when you press “Check for new replies”. Visits from YouTube are in the table above; a comment has no link, so a visit cannot be tied to one comment.">
      <dl className="flex flex-wrap divide-x divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
        {metric("Comments posted", totals.posted)}
        {metric("Likes", totals.likes, "on comments and replies")}
        {metric("Replies from people", totals.replies_received)}
        {metric("Conversations", totals.conversations, "comments with at least one reply")}
        {metric("Our answers posted", totals.replies_posted)}
      </dl>
      {top.length ? (
        <ul className="mt-3 flex flex-col divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {top.map((c) => (
            <li key={c.id} className="flex gap-4 px-4 py-3 text-[13.5px]">
              <div className="num w-[92px] shrink-0 text-[12.5px] text-muted">{c.like_count ?? "—"} likes<br />{c.reply_count ?? "—"} replies</div>
              <div className="min-w-0">
                <p className="line-clamp-2">{c.text}</p>
                <p className="mt-0.5 text-[12px] text-muted">{c.thread_url ? <a href={c.thread_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{c.subject ?? "Video"}</a> : c.subject} · {formatDateTime(c.occurred_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

export function CounterSetup({ slug, site, scriptUrl, productName }: { slug: string; site: SiteSettings; scriptUrl: string; productName: string }) {
  const snippet = `<script defer src="${scriptUrl}" data-site="${site.site_key}"${site.app_store_pt ? ` data-pt="${site.app_store_pt}"` : ""}></script>`;
  const cursorPrompt = `Add a visit counter to every page of this site. Put this exact tag right before </head> in the shared layout (one place, so every page has it):

${snippet}

Do not change it, do not load it twice, keep it on all pages including 404. Do not add cookie banners for it: it sets no cookies. Make sure every "Download on the App Store" button is a normal <a href="https://apps.apple.com/..."> link (not a JS redirect), so the counter can see the click. Then deploy.`;
  const base = site.domain ? `https://${site.domain}/` : null;
  return (
    <Section title="Set up the website counter and tagged links" description={`One line of code on the ${productName} site, plus links with tags for each place you put a link. Tagged links tell the source even when Instagram or Threads hide where the visitor came from.`}>
      <ActionForm action={saveSiteSettingsAction.bind(null, slug)} submitLabel="Save" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
        <Field label="Website domain" htmlFor="site-domain" hint="e.g. backapp.live"><Input id="site-domain" name="domain" defaultValue={site.domain ?? ""} placeholder="backapp.live" /></Field>
        <Field label="App Store link" htmlFor="site-as" hint="The app's page, https://apps.apple.com/…"><Input id="site-as" name="app_store_url" defaultValue={site.app_store_url ?? ""} placeholder="https://apps.apple.com/app/id…" /></Field>
        <Field label="App Store provider token" htmlFor="site-pt" hint="Digits after pt= in an App Store Connect campaign link"><Input id="site-pt" name="app_store_pt" defaultValue={site.app_store_pt ?? ""} /></Field>
      </ActionForm>

      <ol className="mt-4 flex flex-col gap-4 text-[13.5px]">
        <li>
          <p className="font-medium">1. Put the counter on the site</p>
          <p className="text-muted">Paste this prompt into Cursor in the site project. It adds one line to all pages.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-control)] bg-paper p-3 text-[12px]">{snippet}</pre>
          <div className="mt-2 flex gap-2"><CopyButton text={cursorPrompt} label="Copy prompt for Cursor" /><CopyButton text={snippet} label="Copy code only" /></div>
        </li>
        <li>
          <p className="font-medium">2. Use tagged links everywhere you link to the site</p>
          {base ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {LINK_PLACEMENTS.map((p) => {
                const url = taggedUrl(base, p);
                return (
                  <li key={p.key} className="flex flex-wrap items-center gap-2">
                    <span className="w-[260px] text-muted">{p.label}</span>
                    <code className="min-w-0 flex-1 truncate rounded bg-paper px-2 py-1 text-[12px]">{url}</code>
                    <CopyButton text={url} label="Copy link" />
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-muted">Save the website domain above to get the links.</p>}
        </li>
        <li>
          <p className="font-medium">3. Links straight to the App Store, counted by Apple</p>
          {site.app_store_url && site.app_store_pt ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {LINK_PLACEMENTS.map((p) => {
                const url = appStoreCampaignUrl(site.app_store_url!, site.app_store_pt!, p.key);
                return (
                  <li key={p.key} className="flex flex-wrap items-center gap-2">
                    <span className="w-[260px] text-muted">{p.label}</span>
                    <code className="min-w-0 flex-1 truncate rounded bg-paper px-2 py-1 text-[12px]">{url}</code>
                    <CopyButton text={url} label="Copy link" />
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-muted">Add the App Store link and provider token above. With the token, the counter also tags the site&apos;s App Store button, so Apple shows installs per source (web_instagram, web_youtube…).</p>}
        </li>
      </ol>
    </Section>
  );
}
