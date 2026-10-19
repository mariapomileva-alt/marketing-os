import { redirect } from "next/navigation";

export default async function ProductIndex({ params }: PageProps<"/p/[product]">) {
  const { product } = await params;
  redirect(`/p/${product}/overview`);
}
