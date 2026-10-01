import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Preview shim for next/link: a plain anchor. */
export default function Link({
  href,
  children,
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
}) {
  const url = typeof href === "string" ? href : (href.pathname ?? "#");
  return (
    <a href={url} {...rest}>
      {children}
    </a>
  );
}
