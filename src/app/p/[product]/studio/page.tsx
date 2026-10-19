import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { CONTENT_STATUS, ContentStatus } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { STUDIO_CHANNELS, STUDIO_FORMATS } from "@/domain/content";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Content Studio" };

export default async function StudioPage({ params, searchParams }: PageProps<"/p/[product]/studio">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status in CONTENT_STATUS ? sp.status : "";
  const product = await getProduct(slug);
  const items = await db((tx) =>
    tx.query<{ id: string; title: string; status: string; channel: string; format: string; version: number; updated_at: string; blocks: number; is_demo: boolean }>(
      `select i.id, i.title, i.status, i.channel, i.format, v.version, i.updated_at::text, i.is_demo,
              (select count(*)::int from content_reviews r where r.content_version_id = i.current_version_id and r.outcome = 'block') blocks
         from content_items i left join content_versions v on v.id = i.current_version_id
        where i.product_id = $1 and ($2 = '' or i.status = $2) order by i.updated_at desc limit 300`,
      [product.id, status],
    ),
  );
  return (
    <>
      <PageHeader
        title="Content Studio"
        description="Every item is generated from an idea, explained, checked by safety rules and AI reviews, and approved by you before it leaves the system."
        actions={<Button asChild variant="primary"><Link href={`/p/${slug}/ideas`}>Start from an idea</Link></Button>}
      />
      <form className="mb-4 flex items-end gap-2" action={`/p/${slug}/studio`}>
        <label className="text-[13px]">Status{" "}
          <Select name="status" defaultValue={status} className="ml-1 inline-block w-48"><option value="">All</option>{Object.entries(CONTENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        </label>
        <Button type="submit">Filter</Button>
      </form>
      <Section>
        {items.length ? (
          <Table>
            <thead><tr><th>Item</th><th>Channel</th><th>Format</th><th>Status</th><th className="text-right">Version</th><th>Updated</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/p/${slug}/studio/${i.id}`} className="font-medium hover:text-green">{i.title}</Link>{i.blocks ? <span className="ml-2 text-[12px] text-red">blocked by a rule</span> : null}{i.is_demo ? <span className="ml-2 text-[12px] text-amber">demo</span> : null}</td>
                <td>{STUDIO_CHANNELS[i.channel] ?? i.channel}</td><td>{STUDIO_FORMATS[i.format]?.label ?? i.format}</td>
                <td><ContentStatus status={i.status} /></td><td className="num text-right">v{i.version}</td><td className="num whitespace-nowrap text-muted">{formatDateTime(i.updated_at)}</td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title={status ? "Nothing with this status" : "No content yet"}>Content starts from an idea in Hooks & Ideas.</EmptyState>}
      </Section>
    </>
  );
}
