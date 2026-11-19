/** The docs table of contents, in reading order. `segment` is the folder under /docs ("" for the overview). */
export const DOC_PAGES = [
  { segment: "", href: "/docs", title: "Overview" },
  { segment: "check-in", href: "/docs/check-in", title: "How check-in works" },
  { segment: "organizers", href: "/docs/organizers", title: "Organizer playbook" },
  { segment: "sponsors", href: "/docs/sponsors", title: "Sponsor guide" },
  { segment: "security", href: "/docs/security", title: "Security model" },
  { segment: "sdk", href: "/docs/sdk", title: "SDK quickstart" },
] as const;
