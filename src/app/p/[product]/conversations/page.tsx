import { db, getProduct } from "@/server/context";
import { draftReplyAction, logConversationAction, markReplyPostedAction } from "@/app/actions/conversations";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";
import { Tabs, tabParam } from "@/components/ui/tabs";
import { loadYoutube, YoutubeTab } from "./youtube-tab";
import { loadSocial, SocialTab } from "./social-tab";

export const metadata = { title: "Conversations" };
// A search plus a few AI drafts can take a minute; server actions on this page share this limit.
export const maxDuration = 120;

export default async function ConversationsPage({ params, searchParams }: PageProps<"/p/[product]/conversations">) {
  const { product: slug } = await params;
  const tab = tabParam(await searchParams, ["youtube", "threads", "instagram", "other"], "youtube");
  const product = await getProduct(slug);
  const header = (
    <>
      <PageHeader title="Conversations" description="Comments and replies, drafted by AI where useful and always approved by you. The team writes as itself, never as a customer, and mentions the product only when it truly helps." />
      <Tabs base={`/p/${slug}/conversations`} current={tab} tabs={[{ id: "youtube", label: "YouTube" }, { id: "threads", label: "Threads" }, { id: "instagram", label: "Instagram" }, { id: "other", label: "Comments log" }]} />
    </>
  );
  if (tab === "youtube") {
    const y = await db((tx, ctx) => loadYoutube(tx, ctx.workspaceId, product.id));
    return (<>{header}<YoutubeTab slug={slug} data={y} /></>);
  }
  if (tab === "threads" || tab === "instagram") {
    const sd = await db((tx, ctx) => loadSocial(tx, ctx.workspaceId, product.id, tab));
    return (<>{header}<SocialTab slug={slug} channel={tab} data={sd} /></>);
  }
  const d = await db(async (tx) => ({
    convs: await tx.query<{ id: string; channel: string; thread_url: string | null; status: string; sensitive: boolean; created_at: string; post: string | null; messages: Array<{ id: string; direction: string; author_handle: string | null; text: string; status: string; occurred_at: string }> }>(
      `select c.id, c.channel, c.thread_url, c.status, c.sensitive, c.created_at::text, i.title post,
              coalesce((select json_agg(json_build_object('id', m.id, 'direction', m.direction, 'author_handle', m.author_handle, 'text', m.text, 'status', m.status, 'occurred_at', m.occurred_at) order by m.occurred_at)
                          from conversation_messages m where m.conversation_id = c.id), '[]') messages
         from conversations c left join publications p on p.id = c.publication_id left join content_items i on i.id = p.content_item_id
        where c.product_id = $1 and c.channel not in ('youtube', 'threads') order by c.sensitive desc, c.created_at desc limit 100`,
      [product.id],
    ),
    pubs: await tx.query<{ id: string; title: string }>("select p.id, i.title from publications p join content_items i on i.id = p.content_item_id where p.product_id = $1 order by p.published_at desc limit 50", [product.id]),
  }));
  return (
    <>
      {header}
      <Section title="Log a comment">
        <ActionForm action={logConversationAction.bind(null, slug)} submitLabel="Log comment" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
          <Field label="Channel" htmlFor="cv-ch"><Select id="cv-ch" name="channel"><option value="instagram">Instagram</option><option value="threads">Threads</option><option value="facebook">Facebook</option></Select></Field>
          <Field label="On which post" htmlFor="cv-pub"><Select id="cv-pub" name="publication_id"><option value="">Not one of ours</option>{d.pubs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>
          <Field label="Author" htmlFor="cv-au"><Input id="cv-au" name="author_handle" placeholder="@handle" /></Field>
          <Field label="Link to the comment" htmlFor="cv-url" className="md:col-span-3"><Input id="cv-url" name="thread_url" type="url" /></Field>
          <Field label="Comment" htmlFor="cv-text" className="md:col-span-3"><Textarea id="cv-text" name="text" rows={2} required /></Field>
          <label className="flex items-center gap-2 text-[13px] md:col-span-3"><input type="checkbox" name="sensitive" /> The person may be in distress (also detected automatically for crisis words)</label>
        </ActionForm>
      </Section>
      <Section title="Threads">
        {d.convs.length ? (
          <ul className="flex flex-col gap-3">
            {d.convs.map((c) => (
              <li key={c.id} className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${c.sensitive ? "border-red/40" : "border-line"}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
                  <span>{c.channel}{c.post ? `, on “${c.post}”` : ""}, {formatDateTime(c.created_at)}{c.thread_url ? <> · <a href={c.thread_url} target="_blank" rel="noreferrer noopener" className="text-green underline">open</a></> : null}</span>
                  <span className="flex items-center gap-3">{c.sensitive ? <Status tone="red">Sensitive</Status> : null}<Status tone={c.status === "replied" ? "green" : "amber"}>{c.status.replace("_", " ")}</Status></span>
                </div>
                {c.sensitive ? <p className="mb-2 rounded-[var(--radius-control)] bg-red-tint px-3 py-2 text-[12.5px] text-red">Reply as a person, briefly and warmly. Point to emergency services or a crisis line. Do not promote the product.</p> : null}
                <ul className="flex flex-col gap-1.5 text-[13.5px]">
                  {c.messages.map((m) => (
                    <li key={m.id} className={m.direction === "outbound" ? "ml-6" : ""}>
                      <span className="text-muted">{m.direction === "inbound" ? (m.author_handle ?? "Them") : "You"}:</span> {m.text}
                      {m.direction === "outbound" ? <span className="ml-2 text-[12px]"><Status tone={m.status === "posted" ? "green" : m.status === "approved" ? "green" : m.status === "rejected" ? "red" : "amber"}>{m.status === "draft" ? "waiting for approval" : m.status}</Status></span> : null}
                      {m.direction === "outbound" && m.status === "approved" ? <form action={markReplyPostedAction.bind(null, slug, m.id)} className="ml-2 inline"><Button size="sm" variant="ghost">I posted it</Button></form> : null}
                    </li>
                  ))}
                </ul>
                <ActionForm action={draftReplyAction.bind(null, slug, c.id)} submitLabel="Send reply for approval" submitVariant="secondary" resetOnSuccess className="mt-3 flex flex-col gap-2">
                  <Textarea name="reply" rows={2} aria-label="Reply" placeholder="Helpful first, in your own voice" />
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No conversations yet" />}
      </Section>
    </>
  );
}
