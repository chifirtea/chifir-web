import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

/**
 * Preview shim for next/dynamic: React.lazy behind Suspense. `ssr` is meaningless here (there is
 * no server); `loading` renders while the chunk loads, as in Next.
 */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  options: { ssr?: boolean; loading?: () => ReactNode } = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return "default" in mod ? mod : { default: mod };
  });
  const fallback = options.loading ? options.loading() : null;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  };
}
