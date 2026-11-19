import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/ui/Container";
import { Skeleton } from "@/ui/Skeleton";
import { ReportToolbar, SponsorReport } from "../../_components/SponsorReport";

export const metadata: Metadata = {
  title: "Sponsor report",
  description: "A printable sponsor report with every verified payout linked to its QIE transaction.",
  robots: { index: false, follow: false },
};

// No site header or footer: this page is a document, made to be printed or saved as a PDF.
export default function ReportPage({ params }: PageProps<"/sponsor/[campaignId]/report">) {
  return (
    <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
      <Container width="default" className="flex max-w-[62rem] flex-col gap-8 py-8 print:max-w-none print:px-0 print:py-0">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          {params.then(({ campaignId }) => (
            <>
              <ReportToolbar id={campaignId} />
              <div className="rounded-doc bg-sheet px-6 py-8 shadow-sheet sm:px-10 sm:py-12 print:p-0 print:shadow-none">
                <SponsorReport id={campaignId} />
              </div>
            </>
          ))}
        </Suspense>
      </Container>
    </main>
  );
}
