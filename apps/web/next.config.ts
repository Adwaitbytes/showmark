import type { NextConfig } from "next";

// Safe App support: sponsor treasuries open Showmark inside safe.qie.digital, so only that origin may frame us.
const frameAncestors = "frame-ancestors 'self' https://safe.qie.digital https://safe-testnet.qie.digital";

const securityHeaders = [
  { key: "Content-Security-Policy", value: `${frameAncestors}; base-uri 'self'; object-src 'none'; form-action 'self'` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The attendee scanner needs the camera; nothing else needs device APIs.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
