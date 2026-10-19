import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { createIdeaAction } from "@/app/actions/content";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Hooks & Ideas" };

export default async function IdeasPage({ params }: PageProps<"/p/[product]/ideas">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx) => ({
    ideas: await tx.query<{ id: string; title: string; status: string; segment: string | null; job: string | null; hooks: number; items: number; created_at: string }>(
      `select i.id, i.title, i.status, s.code segment, j.statement job, i.created_at::text,
              (select count(*)::int from hooks h where h.idea_id = i.id) hooks, (select count(*)::int from content_items c where c.idea_id = i.id) items
         from ideas i left join segments s on s.id = i.segment_id left join jobs j on j.id = i.job_id where i.product_id = $1 order by i.created_at desc`,
      [product.id],
    ),
    segments: await tx.query<{ id: string; code: string; name: string }>("select id, code, name from segments where product_id = $1 and status = 'active' order by code", [product.id]),
    jobs: await tx.query<{ id: string; statement: string }>("select id, statement from jobs where product_id = $1 order by created_at", [product.id]),
    fears: await tx.query<{ id: string; fear: string }>("select id, fear from fears where product_id = $1 order by created_at", [product.id]),
    quotes: await tx.query<{ id: string; text_verbatim: string }>("select id, text_verbatim from client_quotes where product_id = $1 order by created_at desc", [product.id]),
    signals: await tx.query<{ id: string; label: string }>("select id, coalesce(nullif(hook,''), nullif(topic,''), platform) label from signals where product_id = $1 and validation_status <> 'rejected' order by created_at desc", [product.id]),
    sources: await tx.query<{ id: string; title: string; scope: string }>(
      "select id, title, scope from knowledge_sources where workspace_id = $1 and (product_id = $2 or scope = 'workspace') and status = 'ready' order by scope, title",
      [product.workspace_id, product.id],
    ),
    stages: await tx.query<{ label: string }>("select label from taxonomy_terms where product_id = $1 and vocabulary = 'funnel_stage' and not archived order by label", [product.id]),
  }));
  return (
    <>
      <PageHeader title="Hooks & Ideas" description="An idea ties one segment and one Job (or fear) to the evidence behind it. Hooks and content are generated from the idea, so every variant can explain where it came from." />
      <Section>
        {d.ideas.length ? (
          <Table>
            <thead><tr><th>Idea</th><th>Segment</th><th>Job</th><th className="text-right">Hooks</th><th className="text-right">Content</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{d.ideas.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/p/${slug}/ideas/${i.id}`} className="font-medium hover:text-green">{i.title}</Link></td>
                <td>{i.segment ?? "—"}</td><td className="max-w-[320px] text-muted">{i.job ?? "—"}</td>
                <td className="num text-right">{i.hooks}</td><td className="num text-right">{i.items}</td>
                <td><Status tone={i.status === "done" ? "green" : i.status === "in_production" ? "slate" : "neutral"}>{i.status.replace("_", " ")}</Status></td>
                <td className="num whitespace-nowrap text-muted">{formatDate(i.created_at)}</td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No ideas yet">Start from a segment and a Job you have evidence for, then attach the sources that support the idea.</EmptyState>}
      </Section>
      <Section title="New idea">
        <ActionForm action={createIdeaAction.bind(null, slug)} submitLabel="Create idea" className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-2">
          <Field label="Title" htmlFor="i-title" className="md:col-span-2"><Input id="i-title" name="title" required placeholder="The first minute of a panic wave on the metro" /></Field>
          <Field label="Insight" htmlFor="i-insight" className="md:col-span-2" hint="What we noticed and why it matters. Label it a hypothesis if it is not backed by a quote."><Textarea id="i-insight" name="insight" rows={2} /></Field>
          <Field label="Segment" htmlFor="i-seg"><Select id="i-seg" name="segment_id"><option value="">None</option>{d.segments.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</Select></Field>
          <Field label="Job" htmlFor="i-job"><Select id="i-job" name="job_id"><option value="">None</option>{d.jobs.map((j) => <option key={j.id} value={j.id}>{j.statement.slice(0, 90)}</option>)}</Select></Field>
          <Field label="Fear it addresses" htmlFor="i-fear"><Select id="i-fear" name="fear_id"><option value="">None</option>{d.fears.map((f) => <option key={f.id} value={f.id}>{f.fear.slice(0, 90)}</option>)}</Select></Field>
          <Field label="Customer quote" htmlFor="i-quote"><Select id="i-quote" name="quote_id"><option value="">None</option>{d.quotes.map((q) => <option key={q.id} value={q.id}>“{q.text_verbatim.slice(0, 80)}”</option>)}</Select></Field>
          <Field label="Signal it builds on" htmlFor="i-signal"><Select id="i-signal" name="signal_id"><option value="">None</option>{d.signals.map((s) => <option key={s.id} value={s.id}>{s.label.slice(0, 80)}</option>)}</Select></Field>
          <Field label="Funnel stage" htmlFor="i-stage"><Select id="i-stage" name="funnel_stage"><option value="">Not set</option>{d.stages.map((s) => <option key={s.label}>{s.label}</option>)}</Select></Field>
          <Field label="Topic" htmlFor="i-topic"><Input id="i-topic" name="topic" /></Field>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-[13px] font-medium">Sources (evidence and methodology)</legend>
            {d.sources.length ? (
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-[var(--radius-control)] border border-line p-2 text-[13px] sm:grid-cols-2">
                {d.sources.map((s) => (
                  <label key={s.id} className="flex items-start gap-2"><input type="checkbox" name="source_ids" value={s.id} className="mt-1" /><span>{s.title}<span className="text-faint"> {s.scope === "workspace" ? "methodology" : "evidence"}</span></span></label>
                ))}
              </div>
            ) : <p className="text-[13px] text-muted">No sources yet. Add some in Knowledge.</p>}
          </fieldset>
        </ActionForm>
      </Section>
    </>
  );
}
