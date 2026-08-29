import type { CSSProperties } from 'react';

const maskStyle = {
  WebkitMask: "url('/brand-symbol.svg') center / contain no-repeat",
  mask: "url('/brand-symbol.svg') center / contain no-repeat",
} satisfies CSSProperties;

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 bg-current ${className ?? ''}`}
      style={maskStyle}
      aria-hidden="true"
    />
  );
}
