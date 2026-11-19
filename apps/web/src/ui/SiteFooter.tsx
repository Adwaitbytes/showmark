import Link from "next/link";
import { addresses, isDeployed } from "@/lib/chain/addresses";
import { activeChain, activeChainId, explorerAddress } from "@/lib/chain/chains";
import { PASSPORT_NAV, SITE } from "@/lib/copy/site";
import { Container } from "./Container";
import { shortAddress } from "./format";
import { Guilloche } from "./patterns/guilloche";
import { Wordmark } from "./Wordmark";

const columns: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/traction", label: "Traction" },
      { href: "/#judges-desk", label: "Judges' desk" },
    ],
  },
  {
    title: "Use it",
    links: [
      { href: "/sponsor", label: "Fund a campaign" },
      { href: "/organize", label: "Run an event" },
      { href: PASSPORT_NAV.href, label: PASSPORT_NAV.label },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "/docs/check-in", label: "How check-in works" },
      { href: "/docs/security", label: "Security model" },
      { href: "/docs/sdk", label: "SDK quickstart" },
    ],
  },
];

function FooterLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const className =
    "inline-flex min-h-10 items-center text-base whitespace-nowrap text-ink-soft underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-current";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

/** Site footer: where to go next, the contracts a judge can open, and how this was built. */
export function SiteFooter() {
  const deployed = isDeployed();
  const network = activeChainId === 1990 ? "QIE Mainnet" : "QIE Testnet";
  const contracts = [
    { label: "Registry", address: addresses.registry },
    { label: "Vault", address: addresses.vault },
    { label: "Stamps", address: addresses.stamp },
  ];

  return (
    <footer className="mt-16 border-t border-rule-soft sm:mt-24">
      <Container className="grid grid-cols-1 gap-12 py-14 md:grid-cols-[1.3fr_2fr] md:gap-16 md:py-16">
        <div className="flex max-w-sm flex-col gap-4">
          <Link href="/" className="inline-flex w-fit min-h-11 items-center text-[1.75rem]" aria-label="Showmark, home">
            <Wordmark />
          </Link>
          <p className="text-base text-ink-soft">{SITE.pitch}</p>
          <p className="text-sm text-ink-faint">
            Built for {SITE.hackathon} on {network} (chain {activeChainId}). Development was AI-assisted; the team
            reviews, owns and maintains every line.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title} className="flex flex-col gap-1">
              <h2 className="pb-1 text-sm font-medium text-ink">{column.title}</h2>
              {column.links.map((link) => (
                <FooterLink key={link.href} {...link} />
              ))}
            </nav>
          ))}
          <div className="flex flex-col gap-1">
            <h2 className="pb-1 text-sm font-medium text-ink">Source</h2>
            <FooterLink href={SITE.repoUrl} label="GitHub" external />
            {deployed ? (
              contracts.map((contract) => (
                <a
                  key={contract.label}
                  href={explorerAddress(contract.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 flex-wrap items-baseline gap-x-2 text-base text-ink-soft hover:text-ink"
                >
                  {contract.label}
                  <span className="font-mono text-xs">{shortAddress(contract.address)}</span>
                </a>
              ))
            ) : (
              <p className="pt-2 text-sm text-ink-faint">Contract links appear here once they are deployed to {activeChain.name}.</p>
            )}
          </div>
        </div>
      </Container>
      <Guilloche seed="showmark" variant="band" className="h-12 w-full opacity-70" detail={160} />
    </footer>
  );
}
