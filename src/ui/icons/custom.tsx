import type { SVGProps } from 'react';

/** Hand-drawn icons for what Lucide lacks (same style: 24 px grid, 2 px round stroke, currentColor). */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function Svg({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Screwdriver = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="12" width="6" height="9" rx="2" />
    <path d="M9 16h6M12 12V6M10 2.5 12 6l2-3.5" />
  </Svg>
);

export const Saw = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 8h14v4H2z" />
    <path d="m2 12 1.6 2.5L5.2 12l1.6 2.5L8.4 12l1.6 2.5 1.6-2.5 1.6 2.5L14.4 12" />
    <path d="M16 8h4a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-4" />
  </Svg>
);

export const Pliers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 12 9.5 6 10.5 3 12 5l1.5-2 1 3z" />
    <path d="M12 12 6 21M12 12l6 9" />
    <circle cx="12" cy="12" r="1.5" />
  </Svg>
);

export const Pipe = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h8a6 6 0 0 1 6 6v8M3 12h5a1 1 0 0 1 1 1v8M3 7v5M9 21h8" />
  </Svg>
);

export const TapeMeasure = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="12" r="7" />
    <circle cx="10" cy="12" r="2" />
    <path d="M17 15h5v3h-8M19 15v1.5M21 15v1.5" />
  </Svg>
);

export const Nails = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4h6M7 4v16M14 4h6M17 4v16M7 20l0 1M17 20l0 1" />
  </Svg>
);

export const Socket = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="12" cy="12" r="6" />
    <path d="M10 11v2M14 11v2" />
  </Svg>
);

export const LightSwitch = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <rect x="9" y="6" width="6" height="12" rx="1" />
    <path d="M9 12h6" />
  </Svg>
);
