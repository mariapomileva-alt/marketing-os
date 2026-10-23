import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { listPlaybook, listSources, searchKnowledge } from "@/server/services/knowledge";
import { approveRuleAction, importCourseAction, setRuleApplicabilityAction, syncBlogAction, uploadSourceAction } from "@/app/actions/knowledge";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { formatLocator } from "@/lib/format";

export const metadata = { title: "Knowledge" };

const TABS = [
  { id: "sources", label: "Sources" },
  { id: "search", label: "Search" },
  { id: "playbook", label: "Playbook" },
] as const;

export default async function KnowledgePage({ params, searchParams }: PageProps<"/p/[product]/knowledge">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" ? sp.tab : "sources") as (typeof TABS)[number]["id"];
  const q = typeof sp.q === "string" ? sp.q : "";
  const scope = (typeof sp.scope === "string" ? sp.scope : "all") as "all" | "product" | "workspace";
  const product = await getProduct(slug);
  const data = await db(async (tx, ctx) => ({
    sources: tab === "sources" ? await listSources(tx, ctx.workspaceId, product.id) : [],
    hits: tab === "search" && q ? await searchKnowledge(tx, { workspaceId: ctx.workspaceId, productId: product.id, query: q, includeMethodology: true, scope }) : [],
    rules: tab === "playbook" ? await listPlaybook(tx, ctx.workspaceId, product.id) : [],
    blog: tab === "sources"
      ? await tx.query<{ id: string; url: string; title: string; status: string; error: string | null; idea_id: string | null; found_at: string }>(
          "select id, url, title, status, error, idea_id, found_at::text from blog_articles where product_id = $1 order by found_at desc limit 30", [product.id])
      : [],
    domain: (await tx.maybeOne<{ domain: string | null }>("select domain from site_settings where product_id = $1", [product.id]))?.domain ?? null,
  }));
  const productSources = data.sources.filter((s) => s.scope === "product");
  const methodology = data.sources.filter((s) => s.scope === "workspace");

  return (
    <>
      <PageHeader
        title="Knowledge"
        description={`Evidence about ${product.name} and the shared course methodology. Every passage keeps its source, so every AI conclusion can point back to it.`}
      />
      <nav aria-label="Knowledge views" className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/p/${slug}/knowledge?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13.5px] text-muted hover:text-ink", tab === t.id ? "border-green font-medium text-ink" : "border-transparent")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "sources" ? (
        <>
          <Section title="Our blog" description={`New articles on ${data.domain ?? "the product's site"} are read every morning: each becomes knowledge the agents draw on (comments, replies, calm videos), an idea with drafted Threads posts (drafts only, in Content Studio) and a calm video topic.`}>
            <ActionForm action={syncBlogAction.bind(null, slug)} submitLabel="Check the blog now" pendingLabel="Reading the blog…" submitVariant="secondary" className="mb-3 flex flex-col gap-2"><span /></ActionForm>
            {data.blog.length ? (
              <Table>
                <thead><tr><th>Article</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.blog.map((b) => (
                    <tr key={b.id}>
                      <td className="min-w-[260px]"><a href={b.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{b.title || b.url}</a>{b.error ? <div className="text-[12px] text-red">{b.error}</div> : null}</td>
                      <td><Status tone={b.status === "drafted" || b.status === "ingested" ? "green" : b.status === "failed" ? "red" : "neutral"}>{b.status === "drafted" ? "in knowledge, posts drafted" : b.status === "ingested" ? "in knowledge" : b.status}</Status></td>
                      <td>{b.idea_id ? <Link href={`/p/${slug}/ideas`} className="text-[13px] underline">Threads drafts</Link> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState title="No articles yet">{data.domain ? "Press Check the blog now." : "Set the website domain in Analytics → Set up the website counter first."}</EmptyState>}
          </Section>
          <Section title={`${product.name} evidence`} description="Interviews, reviews, research and notes about this product. Visible only inside this product.">
            {productSources.length ? (
              <SourceTable slug={slug} rows={productSources} />
            ) : (
              <EmptyState title="No evidence for this product yet">
                Upload interviews, call notes, reviews or research. Customer quotes, segments and facts for {product.name} can only come from here.
              </EmptyState>
            )}
            <div className="mt-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <h3 className="text-[14px]">Upload a document</h3>
              <ActionForm action={uploadSourceAction.bind(null, slug)} submitLabel="Upload" pendingLabel="Importing…" resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-3">
                <Field label="File" htmlFor="file" hint="Markdown, TXT, JSON or CSV, up to 5 MB." className="md:col-span-3">
                  <Input id="file" name="file" type="file" accept=".md,.markdown,.txt,.json,.csv" required className="h-auto py-1.5" />
                </Field>
                <Field label="Title" htmlFor="title"><Input id="title" name="title" placeholder="Defaults to the file name" /></Field>
                <Field label="Source type" htmlFor="source_type">
                  <Select id="source_type" name="source_type" defaultValue="doc">
                    {[["doc", "Document"], ["interview", "Customer interview"], ["call", "Sales or research call"], ["transcript", "Transcript"], ["note", "Note"], ["report", "Research report"], ["creative", "Advertising creative"], ["dataset", "Dataset"]].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Confidence" htmlFor="confidence">
                  <Select id="confidence" name="confidence" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
                </Field>
                <Field label="Author" htmlFor="author"><Input id="author" name="author" /></Field>
                <Field label="Document date" htmlFor="document_date"><Input id="document_date" name="document_date" type="date" /></Field>
                <div className="flex flex-col justify-end gap-1.5 text-[13px]">
                  <label className="flex items-center gap-2"><input type="checkbox" name="contains_personal_data" /> Contains personal data</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="consent_recorded" /> Consent recorded</label>
                </div>
              </ActionForm>
            </div>
          </Section>

          <Section title="Methodology (all products)" description="Course materials and AJTBD files. They guide how the system works; they are never evidence about your customers. Participant names are pseudonymised.">
            {methodology.length ? (
              <SourceTable slug={slug} rows={methodology} />
            ) : (
              <EmptyState title="Methodology is not imported yet">Import the course archive and the AJTBD files below. Raw files are stored privately and never added to Git.</EmptyState>
            )}
            <div className="mt-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <h3 className="text-[14px]">Import course materials</h3>
              <ActionForm action={importCourseAction.bind(null, slug)} submitLabel="Import" pendingLabel="Importing…" className="mt-4 flex flex-col gap-3">
                <Field label="Files" htmlFor="files" hint="The vault .zip and, optionally, AJTBD prompt.md, 03-schema-call-record.json, 04-codebook-template.md. Already imported files are skipped.">
                  <Input id="files" name="files" type="file" multiple accept=".zip,.md,.json" required className="h-auto py-1.5" />
                </Field>
              </ActionForm>
            </div>
          </Section>
        </>
      ) : null}

      {tab === "search" ? (
        <Section>
          <form className="mb-5 grid gap-2 sm:grid-cols-[1fr_200px_auto]" action={`/p/${slug}/knowledge`}>
            <input type="hidden" name="tab" value="search" />
            <Input name="q" defaultValue={q} placeholder="Search evidence and methodology, e.g. «страх и барьер» or «night panic»" aria-label="Search query" />
            <Select name="scope" defaultValue={scope} aria-label="Where to search">
              <option value="all">Evidence and methodology</option>
              <option value="product">{product.name} evidence only</option>
              <option value="workspace">Methodology only</option>
            </Select>
            <Button type="submit" variant="primary">Search</Button>
          </form>
          {q && !data.hits.length ? <EmptyState title="Nothing found">Try other words or another language: search covers exact words and meaning.</EmptyState> : null}
          <ol className="flex flex-col gap-3">
            {data.hits.map((h) => (
              <li key={h.chunk_id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <Link href={`/p/${slug}/knowledge/${h.source_id}#${h.chunk_id}`} className="font-medium text-green underline-offset-2 hover:underline">{h.title}</Link>
                  <span className="text-muted">{formatLocator(h.locator)}</span>
                  <span className="text-faint">{h.scope === "workspace" ? "Methodology" : "Product evidence"}</span>
                </div>
                <p className="prose-measure whitespace-pre-line text-[13.5px] leading-relaxed">{h.content.length > 700 ? `${h.content.slice(0, 700)}…` : h.content}</p>
              </li>
            ))}
          </ol>
          {q ? <p className="mt-3 text-[12px] text-faint">Meaning search uses the mock embedding model until a real AI provider is connected.</p> : null}
        </Section>
      ) : null}

      {tab === "playbook" ? (
        <Section description="Rules distilled from the course methodology. They shape prompts and reviews once you approve them; a product can mark a rule as not applicable. Product safety rules always win.">
          {data.rules.length ? (
            <Table>
              <thead><tr><th>Rule</th><th>Statement</th><th>Cited from</th><th>Status</th><th>For {product.name}</th></tr></thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id}>
                    <td className="min-w-[180px] font-medium">{r.title}<div className="text-[12px] font-normal text-faint">{r.area.replace("_", " ")}</div></td>
                    <td className="max-w-[420px] text-muted">{r.statement}</td>
                    <td className="min-w-[180px]">
                      {r.citations.length ? r.citations.map((c) => (
                        <Link key={c.chunk_id} href={`/p/${slug}/knowledge/${c.source_id}#${c.chunk_id}`} className="block text-[12.5px] text-green underline-offset-2 hover:underline">
                          {c.title} <span className="text-muted">{formatLocator(c.locator)}</span>
                        </Link>
                      )) : <span className="text-[12.5px] text-amber">No citation found</span>}
                    </td>
                    <td>
                      {r.status === "approved" ? <Status tone="green">Approved</Status> : (
                        <form action={approveRuleAction.bind(null, slug, r.id)}><Button size="sm" variant="primary">Approve</Button></form>
                      )}
                    </td>
                    <td>
                      <form action={setRuleApplicabilityAction.bind(null, slug, r.id, r.applicability === "not_applicable" ? "applies" : "not_applicable")}>
                        <Button size="sm" variant="ghost">{r.applicability === "not_applicable" ? "Not applicable · undo" : "Applies"}</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No playbook yet">Import the course materials on the Sources tab; the first rules are proposed automatically with citations.</EmptyState>
          )}
        </Section>
      ) : null}
    </>
  );
}

function SourceTable({ slug, rows }: { slug: string; rows: Awaited<ReturnType<typeof listSources>> }) {
  return (
    <Table>
      <thead><tr><th>Title</th><th>Type</th><th>Author</th><th>Date</th><th className="text-right">Passages</th><th>Confidence</th><th>Imported</th></tr></thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td className="max-w-[360px]"><Link href={`/p/${slug}/knowledge/${s.id}`} className="font-medium text-ink hover:text-green">{s.title}</Link>{s.contains_personal_data ? <span className="ml-2 text-[12px] text-amber">personal data</span> : null}</td>
            <td className="text-muted">{String(s.provenance?.kind ?? s.source_type)}</td>
            <td className="max-w-[200px] truncate text-muted">{s.author ?? "—"}</td>
            <td className="num whitespace-nowrap text-muted">{s.document_date ?? "—"}</td>
            <td className="num text-right">{s.chunks}</td>
            <td className="text-muted">{s.confidence}</td>
            <td className="num whitespace-nowrap text-muted">{s.imported_at.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
