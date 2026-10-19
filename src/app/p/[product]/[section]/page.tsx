import { notFound } from "next/navigation";
import { NAV } from "@/components/shell/nav";
import { getProduct } from "@/server/context";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { DataFlag } from "@/components/ui/status";

/** Fallback for sections whose v0.1 screen is not built yet: honest "planned" state, never fake data. */
export default async function SectionFallback({ params }: PageProps<"/p/[product]/[section]">) {
  const { product: slug, section } = await params;
  const item = NAV.flatMap((g) => g.items).find((i) => i.slug === section);
  if (!item) notFound();
  const product = await getProduct(slug);
  return (
    <>
      <PageHeader title={item.label} flags={<DataFlag kind="planned" />} />
      <EmptyState title={`${item.label} is not built yet for ${product.name}`}>
        This section is part of the plan but has no working screen in this build. Nothing here is simulated.
      </EmptyState>
    </>
  );
}
