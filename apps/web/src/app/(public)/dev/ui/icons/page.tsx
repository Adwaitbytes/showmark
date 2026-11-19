import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowmarkSeal } from "@/ui/Wordmark";

export const metadata: Metadata = { title: "Icon sources", robots: { index: false, follow: false } };

const variants = [
  { id: "icon-512", size: 512, inset: 0.14, paper: true },
  { id: "icon-192", size: 192, inset: 0.14, paper: true },
  { id: "maskable-512", size: 512, inset: 0.24, paper: true },
  { id: "apple-180", size: 180, inset: 0.16, paper: true },
  { id: "favicon-64", size: 64, inset: 0.02, paper: false },
] as const;

/** Source artwork for the app icons; e2e/visual/icons.mts screenshots each tile into public/icons. */
export default function IconSources() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main id="main" className="flex flex-wrap items-start gap-8 p-8">
      {variants.map((v) => (
        <div
          key={v.id}
          id={v.id}
          className="grid place-items-center"
          style={{
            width: v.size,
            height: v.size,
            padding: v.size * v.inset,
            background: v.paper ? "#f3efe6" : "transparent",
            color: "#e4442b",
          }}
        >
          <ShowmarkSeal className="size-full text-[#e4442b]" />
        </div>
      ))}
    </main>
  );
}
