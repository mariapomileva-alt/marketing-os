import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { decideApprovalAction } from "@/app/actions/content";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Select, Textarea } from "@/components/ui/form";
import { EmptyState, KeyValue, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import type { ApprovalPayload } from "@/domain/approvals";
import { STUDIO_CHANNELS, STUDIO_FORMATS } from "@/domain/content";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Approval Queue" };

export default async function ApprovalsPage({ params }: PageProps<"/p/[product]/approvals">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx) => ({
    pending: await tx.query<{ id: string; subject_summary: string; payload_snapshot: ApprovalPayload; reason_in_queue: string; created_at: string; item_id: string; version: number; warnings: number }>(
      `select a.id, a.subject_summary, a.payload_snapshot, a.reason_in_queue, a.created_at::text, i.id item_id, v.version,
              (select count(*)::int from content_reviews r where r.content_version_id = a.content_version_id and r.outcome = 'warn') warnings
         from approval_items a join content_versions v on v.id = a.content_version_id join content_items i on i.id = v.content_item_id
        where a.product_id = $1 and a.state = 'pending' order by a.created_at`,
      [product.id],
    ),
    replies: await tx.query<{ id: string; subject_summary: string; payload_snapshot: ApprovalPayload; reason_in_queue: string; inbound: string | null }>(
      `select a.id, a.subject_summary, a.payload_snapshot, a.reason_in_queue,
              (select m2.text from conversation_messages m2 where m2.conversation_id = m.conversation_id and m2.direction = 'inbound' order by m2.occurred_at limit 1) inbound
         from approval_items a join conversation_messages m on m.id = a.conversation_message_id
        where a.product_id = $1 and a.state = 'pending' and a.item_type = 'reply' order by a.created_at`,
      [product.id],
    ),
    decided: await tx.query<{ subject_summary: string; decision: string; note: string; decided_at: string; email: string | null }>(
      `select a.subject_summary, d.decision, d.note, d.decided_at::text, u.email from approval_decisions d join approval_items a on a.id = d.approval_item_id
        left join users u on u.id = d.decided_by where d.product_id = $1 order by d.decided_at desc limit 30`,
      [product.id],
    ),
  }));
  return (
    <>
      <PageHeader title="Approval Queue" description="Nothing is sent without your approval. You approve the exact text, link and destination shown here; any later change sends it back for review." />
      {d.replies.length ? (
        <Section title={`Replies waiting (${d.replies.length})`} description="You post approved replies yourself. Nothing is sent automatically.">
          <ol className="flex flex-col gap-4">
            {d.replies.map((a) => (
              <li key={a.id} className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{a.subject_summary}</p>
                  <KeyValue items={[["Where", a.payload_snapshot.destination.targetUrl ?? "Thread link not recorded"], ["Why it is here", a.reason_in_queue]]} />
                  {a.inbound ? <p className="mt-3 text-[13px] text-muted">They wrote: “{a.inbound}”</p> : null}
                  <p className="mt-3 text-[12px] text-muted">Exactly what you will post:</p>
                  <pre className="prose-measure mt-1 whitespace-pre-wrap rounded-[var(--radius-control)] bg-paper p-3 font-sans text-[14px]">{a.payload_snapshot.text}</pre>
                </div>
                <ActionForm action={decideApprovalAction.bind(null, slug, a.id)} submitLabel="Record decision" className="flex flex-col gap-2">
                  <Field label="Decision" htmlFor={`dec-${a.id}`}><Select id={`dec-${a.id}`} name="decision"><option value="approved">Approve this reply</option><option value="rejected">Reject</option></Select></Field>
                  <Field label="Note" htmlFor={`note-${a.id}`}><Textarea id={`note-${a.id}`} name="note" rows={2} /></Field>
                </ActionForm>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      <Section title={`Content waiting for you (${d.pending.length})`}>
        {d.pending.length ? (
          <ol className="flex flex-col gap-4">
            {d.pending.map((a) => (
              <li key={a.id} className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0">
                  <Link href={`/p/${slug}/studio/${a.item_id}`} className="text-[15px] font-semibold hover:text-green">{a.subject_summary}</Link>
                  <div className="mt-2">
                    <KeyValue items={[
                      ["Where", `${STUDIO_CHANNELS[a.payload_snapshot.channel] ?? a.payload_snapshot.channel}, ${STUDIO_FORMATS[a.payload_snapshot.format]?.label ?? a.payload_snapshot.format}`],
                      ["How", a.payload_snapshot.destination.method === "api" ? `Published through the official API to ${a.payload_snapshot.destination.account}` : "Exported for you to post manually"],
                      ["Version", `v${a.version}`],
                      ["Tracking link", a.payload_snapshot.utmUrl ?? "None"],
                      ["Why it is here", a.reason_in_queue],
                    ]} />
                  </div>
                  <p className="mt-3 text-[12px] text-muted">Exactly what will be posted:</p>
                  <pre className="prose-measure mt-1 whitespace-pre-wrap rounded-[var(--radius-control)] bg-paper p-3 font-sans text-[14px] leading-relaxed">{a.payload_snapshot.text}</pre>
                  {a.warnings ? <p className="mt-2 text-[13px] text-amber">{a.warnings} review{a.warnings > 1 ? "s" : ""} raised warnings. <Link className="underline" href={`/p/${slug}/studio/${a.item_id}`}>See findings</Link></p> : null}
                </div>
                <ActionForm action={decideApprovalAction.bind(null, slug, a.id)} submitLabel="Record decision" className="flex flex-col gap-2">
                  <Field label="Decision" htmlFor={`dec-${a.id}`}>
                    <Select id={`dec-${a.id}`} name="decision"><option value="approved">Approve this exact version</option><option value="changes_requested">Request changes</option><option value="rejected">Reject</option></Select>
                  </Field>
                  <Field label="Note" htmlFor={`note-${a.id}`} hint="Required when rejecting or requesting changes."><Textarea id={`note-${a.id}`} name="note" rows={3} /></Field>
                </ActionForm>
              </li>
            ))}
          </ol>
        ) : <EmptyState title="Nothing waiting">Items arrive here from Content Studio once they pass the safety rules and AI reviews.</EmptyState>}
      </Section>
      <Section title="Recent decisions">
        {d.decided.length ? (
          <Table>
            <thead><tr><th>Item</th><th>Decision</th><th>Note</th><th>By</th><th>When</th></tr></thead>
            <tbody>{d.decided.map((x, i) => (
              <tr key={i}><td>{x.subject_summary}</td><td><Status tone={x.decision === "approved" ? "green" : x.decision === "rejected" ? "red" : "amber"}>{x.decision.replace("_", " ")}</Status></td><td className="text-muted">{x.note || "—"}</td><td>{x.email ?? "—"}</td><td className="num whitespace-nowrap">{formatDateTime(x.decided_at)}</td></tr>
            ))}</tbody>
          </Table>
        ) : <p className="text-[13px] text-muted">No decisions yet.</p>}
      </Section>
    </>
  );
}
