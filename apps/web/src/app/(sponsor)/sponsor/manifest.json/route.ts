// Safe App manifest. safe.qie.digital (a Safe{Wallet} build) fetches `${appUrl}/manifest.json` from the browser when a
// custom app is added with the URL https://<host>/sponsor, so it must answer cross-origin GETs. The icon URL is
// absolute because the Safe resolves relative icon paths inconsistently across versions.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "X-Requested-With, content-type, Authorization",
};

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  return Response.json(
    {
      name: "Showmark",
      short_name: "Showmark",
      description: "Fund events per verified attendee. Every payout is a transaction you can open on the QIE explorer.",
      iconPath: `${origin}/sponsor/icon.svg`,
      icons: [{ src: `${origin}/sponsor/icon.svg`, sizes: "any", type: "image/svg+xml" }],
    },
    { headers: { ...CORS, "cache-control": "public, max-age=3600" } },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
