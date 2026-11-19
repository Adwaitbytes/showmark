import type { SVGProps } from "react";

// Attendee-only icons drawn on the design system's grid (src/ui/icons.tsx): 20 px, 1.5 px stroke,
// round caps, currentColor, decorative by default. Candidates to move into src/ui/icons.tsx.

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A passport booklet with a seal on the cover. */
export function PassportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 2.75h9.25a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1H5a.75.75 0 0 1-.75-.75V3.5A.75.75 0 0 1 5 2.75Z" />
      <circle cx="9.75" cy="8.5" r="2.5" />
      <path d="M7.5 13.5h4.5" />
    </Icon>
  );
}

/** Viewfinder corners around a small code. */
export function ScanIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.75 6.5V4a1.25 1.25 0 0 1 1.25-1.25h2.5M13.5 2.75H16A1.25 1.25 0 0 1 17.25 4v2.5M17.25 13.5V16A1.25 1.25 0 0 1 16 17.25h-2.5M6.5 17.25H4A1.25 1.25 0 0 1 2.75 16v-2.5" />
      <path d="M6.75 6.75h2.5v2.5h-2.5zM10.75 10.75h2.5v2.5h-2.5zM10.75 6.75h2.5M6.75 13.25h2.5" />
    </Icon>
  );
}

/** A torch, for the camera light. */
export function TorchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 2.75h7l-1.25 4.5h-4.5L6.5 2.75Z" />
      <path d="M7.75 7.25v8.5a1.5 1.5 0 0 0 1.5 1.5h1.5a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
      <path d="M10 10.25v2" />
    </Icon>
  );
}

/** Four arrows pointing out, for full screen. */
export function ExpandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5" />
    </Icon>
  );
}

/** A wallet with a clasp. */
export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5.75A1.75 1.75 0 0 1 4.75 4h9.5v2.75" />
      <path d="M3 5.75v9.5A1.75 1.75 0 0 0 4.75 17h11.5a.75.75 0 0 0 .75-.75v-8.75a.75.75 0 0 0-.75-.75H4.75A1.75 1.75 0 0 1 3 5.75Z" />
      <circle cx="13.75" cy="11.75" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}
