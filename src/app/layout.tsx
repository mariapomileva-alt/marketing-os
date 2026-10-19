import type { Metadata } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Marketing OS", template: "%s · Marketing OS" },
  description: "Marketing operating system: knowledge, audiences, content, approvals and experiments for every product.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
