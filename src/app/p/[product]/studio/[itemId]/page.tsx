import Link from "next/link";
import { notFound } from "next/navigation";
import { db, getProduct } from "@/server/context";
import { approvedQueueItem, buildApprovalPayload, getItem, reviewsFor, versionsOf } from "@/server/services/content";
import {
  backToDraftAction, createUtmAction, markPublishedAction, runReviewsAction, saveEditAction, scheduleAction, submitForApprovalAction, updateExperimentAction,
} from "@/app/actions/content";
import { publishThreadsPostAction } from "@/app/actions/threads";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, KeyValue, PageHeader, Section } from "@/components/ui/layout";
import { ContentStatus, DataFlag, Status } from "@/components/ui/status";
import { Rationale } from "@/components/content/rationale";
import { ContentFields } from "@/components/content/editor";
import { approvalHash } from "@/domain/approvals";
import { renderText, STUDIO_CHANNELS, STUDIO_FORMATS } from "@/domain/content";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Content item" };

const REVIEWER: Record<string, string> = { guardrails: "Safety rules (code)", brand_ai: "Brand review (AI)", compliance_ai: "Compliance review (AI)", human: "Human" };
const METRICS = ["reach", "views", "saves", "shares", "comments", "clicks", "registrations", "trial_starts", "payments"];

export default async function ItemPage({ params }: PageProps<"/p/[product]/studio/[itemId]">) {
  const { product: slug, itemId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(itemId)) notFound();
  const product = await getProduct(slug);
  const d = await db(async (tx) => {
    const item = await getItem(tx, product.id, itemId);
    if (!item) return null;
    const payload = await buildApprovalPayload(tx, product.id, itemId);
    return {
      item,
      payload,
      reviews: await reviewsFor(tx, item.current_version_id),
      versions: await versionsOf(tx, itemId),
      approved: await approvedQueueItem(tx, product.id, itemId),
      pending: await tx.maybeOne<{ id: string }>("select id from approval_items where content_version_id = $1 and state = 'pending'", [item.current_version_id]),
      utm: await tx.maybeOne<{ full_url: string; landing_url: string }>("select full_url, landing_url from utm_links where content_item_id = $1 order by created_at desc limit 1", [itemId]),
      links: await tx.query<{ url: string; label: string }>("select url, label from product_links where product_id = $1 union all select website_url, 'Website' from products where id = $1 and website_url is not null", [product.id]),
      experiment: await tx.one<{ hypothesis: string; primary_metric: string; counter_metric: string | null; min_sample: number | null; window_days: number; production_cost: string | null; locked_at: string | null; dimensions_snapshot: Record<string, unknown> }>(
        "select hypothesis, primary_metric, counter_metric, min_sample, window_days, production_cost::text, locked_at::text, dimensions_snapshot from experiments where content_item_id = $1",
        [itemId],
      ),
      publication: await tx.maybeOne<{ external_url: string; published_at: string }>("select external_url, published_at::text from publications where content_item_id = $1 order by published_at desc limit 1", [itemId]),
      sources: await tx.query<{ id: string; title: string; scope: string }>(
        "select id, title, scope from knowledge_sources where id = any($1::uuid[])",
        [item.evidence.filter((e) => e.kind === "source").map((e) => e.id)],
      ),
    };
  });
  if (!d) notFound();
  const { item } = d;
  const editable = item.status !== "published" && item.status !== "archived";
  const blocking = d.reviews.some((r) => r.outcome === "block");
  const approvedStillValid = d.approved ? approvalHash(d.payload) === d.approved.payload_hash : false;

  return (
    <>
      <PageHeader
        title={item.title}
        description={`${STUDIO_CHANNELS[item.channel] ?? item.channel}, ${STUDIO_FORMATS[item.format]?.label ?? item.format}, goal: ${item.goal || "—"}, language: ${item.language}. Version ${item.version}.`}
        flags={<><ContentStatus status={item.status} />{item.is_mock ? <DataFlag kind="mock" /> : null}</>}
        actions={<Link href={`/p/${slug}/studio`} className="text-[13px] text-green underline-offset-2 hover:underline">All content</Link>}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Section title="Draft">
            <pre className="prose-measure whitespace-pre-wrap rounded-[var(--radius-panel)] border border-line bg-surface p-4 font-sans text-[14px] leading-relaxed">{renderText(item.body, item.format) || "Empty"}</pre>
            {item.visual_concept ? <p className="mt-2 text-[13px] text-muted">Visual concept: {item.visual_concept}</p> : null}
          </Section>

          <Section title="Reviews" description="Safety rules run in code and block on any match. AI reviews add findings for you to judge." actions={editable ? <form action={runReviewsAction.bind(null, slug, itemId)}><Button size="sm">Run reviews again</Button></form> : null}>
            {d.reviews.length ? (
              <ul className="flex flex-col gap-2">
                {d.reviews.map((r, i) => (
                  <li key={i} className="rounded-[var(--radius-panel)] border border-line bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{REVIEWER[r.reviewer] ?? r.reviewer}</span>
                      <Status tone={r.outcome === "block" ? "red" : r.outcome === "warn" ? "amber" : "green"}>{r.outcome === "block" ? "Blocks" : r.outcome === "warn" ? "Warnings" : "No findings"}</Status>
                    </div>
                    {r.findings.length ? (
                      <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
                        {r.findings.map((f, j) => (
                          <li key={j}><span className={f.severity === "block" ? "text-red" : "text-amber"}>{f.severity === "block" ? "Blocks" : "Warns"}</span> {f.message}{f.excerpt ? <span className="block text-[12px] text-muted">{f.excerpt}</span> : null}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="Not reviewed yet" />}
          </Section>

          {editable ? (
            <Section title="Edit" description="Saving creates a new version. Approvals of older versions stop counting automatically.">
              <ActionForm action={saveEditAction.bind(null, slug, itemId, item.format)} submitLabel="Save as new version" className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                <ContentFields format={item.format} body={item.body} visualConcept={item.visual_concept} />
              </ActionForm>
            </Section>
          ) : null}

          <Section title="Version history">
            <ol className="flex flex-col gap-2">
              {d.versions.map((v) => (
                <li key={v.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-[13px]">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">v{v.version} by {v.author_type === "ai" ? `AI (${v.model ?? "model"})` : (v.author_email ?? "you")}</span>
                    <span className="text-muted">{formatDateTime(v.created_at)}</span>
                  </div>
                  {v.edit_note ? <p className="mt-1">{v.edit_note}</p> : null}
                  {v.diff_from_previous?.length ? (
                    <ul className="mt-1.5 text-[12.5px] text-muted">{v.diff_from_previous.map((c, i) => <li key={i}>Changed <span className="text-ink">{c.field}</span></li>)}</ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="min-w-0">
          <Section title="Next step">
            <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              {item.status === "draft" || item.status === "ai_review" ? (
                blocking ? <p className="text-[13px] text-red">A safety rule blocks this version. Edit the text, then run the reviews again.</p>
                  : <p className="text-[13px] text-muted">Run the reviews to move it to your review.</p>
              ) : null}
              {item.status === "needs_human_review" ? (
                d.pending ? <p className="text-[13px]">Waiting in the <Link href={`/p/${slug}/approvals`} className="text-green underline">Approval Queue</Link>.</p> : (
                  <ActionForm action={submitForApprovalAction.bind(null, slug, itemId)} submitLabel="Send to Approval Queue" className="flex flex-col gap-2">
                    <p className="text-[13px] text-muted">You will see exactly what will be sent and where before approving.</p>
                  </ActionForm>
                )
              ) : null}
              {item.status === "approved" || item.status === "scheduled" ? (
                <>
                  {!approvedStillValid ? <p className="text-[13px] text-red">What would be sent no longer matches what you approved. Send it back to draft.</p> : null}
                  <ActionForm action={scheduleAction.bind(null, slug, itemId)} submitLabel={item.status === "scheduled" ? "Move" : "Place on calendar"} className="flex flex-col gap-2">
                    <Field label="Date and time" htmlFor="scheduled_for"><Input id="scheduled_for" name="scheduled_for" type="datetime-local" required defaultValue={item.scheduled_for ? item.scheduled_for.slice(0, 16) : ""} /></Field>
                  </ActionForm>
                  {item.channel === "threads" ? (
                    <ActionForm action={publishThreadsPostAction.bind(null, slug, itemId)} submitLabel="Publish on Threads now" pendingLabel="Publishing…" className="flex flex-col gap-2 border-b border-line pb-3">
                      <p className="text-[13px] text-muted">Publishes this exact approved version from the connected Threads account. Placed on the calendar, it goes out by itself at that time.</p>
                    </ActionForm>
                  ) : null}
                  <Button asChild variant="primary"><a href={`/p/${slug}/studio/${itemId}/export`}>Download export for {STUDIO_CHANNELS[item.channel] ?? item.channel}</a></Button>
                  <ActionForm action={markPublishedAction.bind(null, slug, itemId)} submitLabel="Mark as published" className="flex flex-col gap-2 border-t border-line pt-3">
                    <p className="text-[13px] text-muted">After you post it, paste the link to the live post so metrics can be matched.</p>
                    <Field label="Link to the post" htmlFor="external_url"><Input id="external_url" name="external_url" type="url" required /></Field>
                    <Field label="Published at" htmlFor="published_at"><Input id="published_at" name="published_at" type="datetime-local" /></Field>
                  </ActionForm>
                  <form action={backToDraftAction.bind(null, slug, itemId)}><Button size="sm" variant="ghost">Send back to draft</Button></form>
                </>
              ) : null}
              {item.status === "published" && d.publication ? (
                <p className="text-[13px]">Published {formatDateTime(d.publication.published_at)}. <a href={d.publication.external_url} target="_blank" rel="noreferrer noopener" className="text-green underline">Open post</a>. Add metrics in <Link className="text-green underline" href={`/p/${slug}/publications`}>Publications</Link>.</p>
              ) : null}
              {item.status === "rejected" ? <form action={backToDraftAction.bind(null, slug, itemId)}><Button size="sm">Reopen as draft</Button></form> : null}
            </div>
          </Section>

          <Section title="Tracking link">
            {d.utm ? <p className="break-all rounded-[var(--radius-control)] bg-sage-tint p-2 text-[12.5px]">{d.utm.full_url}</p> : null}
            {editable && !["approved", "scheduled"].includes(item.status) ? (
              d.links.length ? (
                <ActionForm action={createUtmAction.bind(null, slug, itemId)} submitLabel={d.utm ? "Make another link" : "Create UTM link"} className="mt-2 flex flex-col gap-2">
                  <Field label="Landing page" htmlFor="landing_url"><Select id="landing_url" name="landing_url">{d.links.map((l) => <option key={l.url} value={l.url}>{l.label}: {l.url}</option>)}</Select></Field>
                </ActionForm>
              ) : <p className="text-[13px] text-muted">Add the product website or landing page under <Link href={`/p/${slug}/products`} className="text-green underline">Products</Link> to create a tracking link.</p>
            ) : null}
          </Section>

          <Section title="Why this variant">
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <Rationale r={item.rationale} />
              <div className="mt-3 border-t border-line pt-3 text-[12.5px]">
                <p className="mb-1 text-muted">Sources</p>
                {d.sources.length ? d.sources.map((s) => <Link key={s.id} href={`/p/${slug}/knowledge/${s.id}`} className="block text-green hover:underline">{s.title}</Link>) : <span className="text-amber">No sources cited</span>}
              </div>
            </div>
          </Section>

          <Section title="Experiment plan" description={d.experiment.locked_at ? "Locked at publication: these were set before results were known." : "Set before publishing. Locked when the item is published."}>
            <ActionForm action={updateExperimentAction.bind(null, slug, itemId)} submitLabel="Save plan" hideSubmit={!!d.experiment.locked_at} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <fieldset disabled={!!d.experiment.locked_at} className="flex flex-col gap-2">
                <Field label="Hypothesis" htmlFor="hypothesis"><Textarea id="hypothesis" name="hypothesis" rows={2} defaultValue={d.experiment.hypothesis} /></Field>
                <Field label="Primary metric" htmlFor="primary_metric"><Select id="primary_metric" name="primary_metric" defaultValue={d.experiment.primary_metric}>{METRICS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</Select></Field>
                <Field label="Counter-metric" htmlFor="counter_metric" hint="What must not get worse (e.g. refunds)."><Input id="counter_metric" name="counter_metric" defaultValue={d.experiment.counter_metric ?? ""} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Window, days" htmlFor="window_days"><Input id="window_days" name="window_days" type="number" min={1} max={365} defaultValue={d.experiment.window_days} /></Field>
                  <Field label="Minimum sample" htmlFor="min_sample"><Input id="min_sample" name="min_sample" type="number" min={1} defaultValue={d.experiment.min_sample ?? ""} /></Field>
                </div>
                <Field label="Production cost, EUR" htmlFor="production_cost"><Input id="production_cost" name="production_cost" type="number" step="0.01" min={0} defaultValue={d.experiment.production_cost ?? ""} /></Field>
              </fieldset>
            </ActionForm>
          </Section>

          <Section title="Decision context">
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <KeyValue items={Object.entries(d.experiment.dimensions_snapshot).filter(([, v]) => v !== null && v !== "").map(([k, v]) => [k.replaceAll("_", " "), Array.isArray(v) ? v.join(", ") : String(v)])} />
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}
