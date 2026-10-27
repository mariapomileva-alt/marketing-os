export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[68ch] px-4 py-12 text-[15px] leading-[1.65] text-ink [&_h1]:mb-2 [&_h1]:text-[28px] [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-[18px] [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3 [&_ul]:mt-2">
      {children}
    </main>
  );
}
