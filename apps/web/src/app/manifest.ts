import type { MetadataRoute } from "next";
import { SITE } from "@/lib/copy/site";

/** Makes the attendee app installable: it opens on the pass, with scan and passport one tap away. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/pass",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3efe6",
    theme_color: "#f3efe6",
    categories: ["events", "social", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scan a door code", short_name: "Scan", url: "/scan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My passport", short_name: "Passport", url: "/me", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
