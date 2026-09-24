"use client";

import type { SVGProps } from "react";

import { Logo } from "./reactor-ui";

/**
 * Reactor TV as one vector lockup. The Reactor mark and wordmark stay the
 * package-owned asset. TV extends it at the same cap height and stroke mass.
 */
export default function ReactorTvLockup(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 4165 374.84"
      role="img"
      aria-label="Reactor TV"
      fill="currentColor"
      {...props}
    >
      <Logo
        variant="combined"
        color="currentColor"
        x="0"
        y="0"
        width="3267.17"
        height="374.84"
        aria-hidden
      />
      <g className="reactor-tv-suffix" fill="var(--dune)">
        <path d="M3805.35 76.97h-118.2v291.6h-81.8V76.97h-118.18V6.27h318.18v70.71Z" />
        <path d="M3830 6.27h85l82.5 278.73L4080 6.27h85l-111 362.3h-113L3830 6.27Z" />
      </g>
    </svg>
  );
}
