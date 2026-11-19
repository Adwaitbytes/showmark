// The Showmark seal as a standalone SVG, for the Safe App list. Mirrors ShowmarkSeal in src/ui/Wordmark.tsx.
const SEAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">
<rect width="64" height="64" rx="12" fill="#f3efe6"/>
<circle cx="32" cy="32" r="22" fill="none" stroke="#e4442b" stroke-width="3.4"/>
<circle cx="32" cy="32" r="17" fill="none" stroke="#e4442b" stroke-width="1.4"/>
<text x="32" y="40.5" text-anchor="middle" font-size="25" font-family="Georgia, 'Times New Roman', serif" fill="#e4442b">S</text>
</svg>`;

export function GET(): Response {
  return new Response(SEAL, {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" },
  });
}
