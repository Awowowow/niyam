import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="m4 10.5 3.5 3.5L16 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M4 10h11M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <rect
        x="7"
        y="2.5"
        width="6"
        height="10"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15.8 12.4A6.4 6.4 0 0 1 7.6 4.2 6.5 6.5 0 1 0 15.8 12.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle
        cx="10"
        cy="10"
        r="3.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 2v2M10 16v2M2 10h2M16 10h2M4.35 4.35l1.42 1.42M14.23 14.23l1.42 1.42M15.65 4.35l-1.42 1.42M5.77 14.23l-1.42 1.42"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <rect
        x="4.5"
        y="8.25"
        width="11"
        height="8.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7 8.25V6a3 3 0 0 1 6 0v2.25M10 11.25v2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M5 2.5h7l3 3V18H5z" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 2.5V6h3M7.5 10h5M7.5 13h5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function NiyamMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5 7h22M16 7v6M7 15h7M18 17h7M16 19v6M8 25h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m13 18 3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
