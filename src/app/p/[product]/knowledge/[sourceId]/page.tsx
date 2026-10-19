import Link from "next/link";
import { notFound } from "next/navigation";
import { db, getProduct } from "@/server/context";
import { KeyValue, PageHeader, Section } from "@/components/ui/layout";
import { formatDate, formatLocator } from "@/lib/format";

export const metadata = { title: "Source" };

export default async function SourcePage({ params }: PageProps<"/p/[product]/knowledge/[sourceId]">) {
  const { product: slug, sourceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(sourceId)) notFound();
  const product = await getProduct(slug);
  const data = await db(async (tx) => {
    const source = await tx.maybeOne<{
      id: string; title: string; scope: string; source_type: string; author: string | null; document_date: string | null; confidence: string;
      original_filename: string | null; imported_at: string; product_id: string | null; provenance: Record<string, unknown>; contains_personal_data: boolean; consent_recorded: boolean;
    }>("select id, title, scope, source_type, author, document_date::text, confidence, original_filename, imported_at::text, product_id, provenance, contains_personal_data, consent_recorded from knowledge_sources where id = $1", [sourceId]);
    if (!source || (source.scope === "product" && source.product_id !== product.id)) return null;
    const chunks = await tx.query<{ id: string; ordinal: number; content: string; locator: Record<string, unknown> }>(
      "select id, ordinal, content, locator from knowledge_chunks where source_id = $1 order by ordinal",
      [sourceId],
    );
    return { source, chunks };
  });
  if (!data) notFound();
  const { source, chunks } = data;
  const prov = source.provenance ?? {};
  return (
    <>
      <PageHeader
        title={source.title}
        description={source.scope === "workspace" ? "Methodology source, shared by all products. It guides the work; it is not evidence about customers." : `Evidence for ${product.name}.`}
        actions={<Link href={`/p/${slug}/knowledge`} className="text-[13px] text-green underline-offset-2 hover:underline">All sources</Link>}
      />
      <Section title="Provenance">
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <KeyValue
            items={[
              ["Original file", source.original_filename ?? "—"],
              ["Type", String(prov.kind ?? source.source_type)],
              ["Author", source.author ?? "Unknown"],
              ["Document date", source.document_date ?? "Unknown"],
              ["Confidence", source.confidence],
              ["Imported", formatDate(source.imported_at)],
              ...(prov.origin ? [["Origin", String(prov.origin)] as [string, string]] : []),
              ...(prov.path ? [["Path in archive", String(prov.path)] as [string, string]] : []),
              ["Personal data", source.contains_personal_data ? (prov.pseudonymised ? "Yes, participants pseudonymised" : source.consent_recorded ? "Yes, consent recorded" : "Yes") : "No"],
            ]}
          />
        </div>
      </Section>
      <Section title={`Passages (${chunks.length})`}>
        <ol className="flex flex-col gap-3">
          {chunks.map((c) => (
            <li key={c.id} id={c.id} className="scroll-mt-20 rounded-[var(--radius-panel)] border border-line bg-surface p-4 target:border-green target:ring-1 target:ring-green">
              <p className="mb-1.5 text-[12px] text-muted">#{c.ordinal + 1} {formatLocator(c.locator)}</p>
              <p className="prose-measure whitespace-pre-line text-[13.5px] leading-relaxed">{c.content}</p>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
