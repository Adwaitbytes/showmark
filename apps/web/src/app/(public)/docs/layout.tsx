import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { DocsNav } from "./DocsNav";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <PageShell current="docs">
      <Container className="grid grid-cols-[minmax(0,1fr)] gap-8 pt-8 pb-8 sm:pt-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <aside>
          <DocsNav />
        </aside>
        <article className="min-w-0">{children}</article>
      </Container>
    </PageShell>
  );
}
