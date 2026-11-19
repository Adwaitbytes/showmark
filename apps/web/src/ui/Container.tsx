import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const widths = {
  prose: "max-w-[44rem]",
  default: "max-w-[76rem]",
  wide: "max-w-[90rem]",
} as const;

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: keyof typeof widths;
}

/** Horizontal rhythm for every page: 16 px gutters on phones, 24 on tablets, 32 on desktop. */
export function Container({ width = "default", className, children, ...rest }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", widths[width], className)} {...rest}>
      {children}
    </div>
  );
}
