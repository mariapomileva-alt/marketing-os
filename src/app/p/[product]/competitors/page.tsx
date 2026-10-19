import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { addCompetitorAction } from "@/app/actions/research";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";

export const metadata = { title: "Competitors" };

export default async function CompetitorsPage({ params }: PageProps<"/p/[product]/competitors">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const rows = await db((tx) =>
    tx.query<{ id: string; name: string; website_url: string | null; positioning: string; notes: string; signals: number }>(
      "select c.*, (select count(*)::int from signals s where s.competitor_id = c.id) signals from competitors c where c.product_id = $1 order by c.name",
      [product.id],
    ),
  );
  return (
    <>
      <PageHeader title="Competitors" description={`Alternatives people consider instead of ${product.name}. Their creatives are recorded as signals and broken down by structure.`} />
      <Section>
        {rows.length ? (
          <Table>
            <thead><tr><th>Name</th><th>Positioning</th><th>Notes</th><th className="text-right">Signals</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.website_url ? <a className="hover:text-green" href={c.website_url} target="_blank" rel="noreferrer noopener">{c.name}</a> : c.name}</td>
                <td className="max-w-[380px]">{c.positioning || "—"}</td><td className="max-w-[320px] text-muted">{c.notes || "—"}</td>
                <td className="num text-right"><Link className="text-green underline" href={`/p/${slug}/signals`}>{c.signals}</Link></td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No competitors yet">Include indirect alternatives too: other apps, breathing videos, doing nothing.</EmptyState>}
      </Section>
      <Section title="Add a competitor">
        <ActionForm action={addCompetitorAction.bind(null, slug)} submitLabel="Add competitor" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-2">
          <Field label="Name" htmlFor="c-name"><Input id="c-name" name="name" required /></Field>
          <Field label="Website" htmlFor="c-url"><Input id="c-url" name="website_url" type="url" /></Field>
          <Field label="Positioning" htmlFor="c-pos" className="md:col-span-2"><Input id="c-pos" name="positioning" /></Field>
          <Field label="Notes" htmlFor="c-notes" className="md:col-span-2"><Textarea id="c-notes" name="notes" rows={2} /></Field>
        </ActionForm>
      </Section>
    </>
  );
}
