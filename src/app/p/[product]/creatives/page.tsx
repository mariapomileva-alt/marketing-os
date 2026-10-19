import { db, getProduct } from "@/server/context";
import { uploadAssetAction } from "@/app/actions/creatives";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Creative Library" };

export default async function CreativesPage({ params }: PageProps<"/p/[product]/creatives">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const assets = await db((tx) =>
    tx.query<{ id: string; title: string; origin: string; tags: string[]; rights_note: string; created_at: string }>(
      "select id, title, origin, tags, rights_note, created_at::text from creative_assets where product_id = $1 order by created_at desc", [product.id]),
  );
  return (
    <>
      <PageHeader title="Creative Library" description="Images for this product's posts and carousels, with their source and usage rights. Image generation (Canva, Kling, image models) is planned for v0.7." />
      <Section title="Add an image">
        <ActionForm action={uploadAssetAction.bind(null, slug)} submitLabel="Upload" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
          <Field label="Image" htmlFor="as-file" hint="PNG, JPEG or WebP, up to 5 MB."><Input id="as-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required className="h-auto py-1.5" /></Field>
          <Field label="Title" htmlFor="as-title"><Input id="as-title" name="title" /></Field>
          <Field label="Origin" htmlFor="as-origin"><Select id="as-origin" name="origin"><option value="uploaded">Our own</option><option value="competitor_reference">Competitor reference (not for posting)</option></Select></Field>
          <Field label="Tags" htmlFor="as-tags" hint="Comma-separated, e.g. carousel, calm, metro"><Input id="as-tags" name="tags" /></Field>
          <Field label="Source and rights" htmlFor="as-rights" className="md:col-span-2" hint="Where it comes from and why we may use it (e.g. made in Canva by us)."><Input id="as-rights" name="rights_note" required /></Field>
        </ActionForm>
      </Section>
      <Section title={`Images (${assets.length})`}>
        {assets.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {assets.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated file route */}
                <img src={`/p/${slug}/creatives/${a.id}`} alt={a.title} className="aspect-square w-full object-cover" loading="lazy" />
                <div className="p-2 text-[12.5px]">
                  <p className="truncate font-medium">{a.title}</p>
                  <p className="truncate text-muted">{a.origin === "competitor_reference" ? "Reference only" : a.tags.join(", ") || "No tags"}</p>
                  <p className="text-faint">{formatDate(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No images yet" />}
      </Section>
    </>
  );
}
