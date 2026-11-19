import type { SVGProps } from "react";

/**
 * A small hand-drawn icon set: 20 px grid, 1.5 px stroke, round caps, currentColor. Icons are
 * decorative by default; give the control an accessible name instead of labelling the icon.
 */
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

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.75" y="6.75" width="9.5" height="9.5" rx="1.5" />
      <path d="M13.25 6.75V5.25a1.5 1.5 0 0 0-1.5-1.5h-6.5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </Icon>
  );
}

/** Opens somewhere outside Showmark, such as the explorer. */
export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 4.75H5.25a1.5 1.5 0 0 0-1.5 1.5v8.5a1.5 1.5 0 0 0 1.5 1.5h8.5a1.5 1.5 0 0 0 1.5-1.5V12" />
      <path d="M11.25 3.75h5v5M16 4l-6.75 6.75" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.75 10h12.5M11.5 5.25 16.25 10l-4.75 4.75" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 6.5h13M3.5 13.5h13" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 5 10 10M15 5 5 15" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="3.25" />
      <path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.9 4.9l1.05 1.05M14.05 14.05l1.05 1.05M4.9 15.1l1.05-1.05M14.05 5.95l1.05-1.05" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.75 12.4A6.5 6.5 0 0 1 7.6 4.25a6.5 6.5 0 1 0 8.15 8.15Z" />
    </Icon>
  );
}

export function SystemIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="6.25" />
      <path d="M10 3.75v12.5" />
      <path d="M10 3.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.75 10a5.75 5.75 0 1 1-1.7-4.08" />
      <path d="M15.75 3.75v3.5h-3.5" />
    </Icon>
  );
}
