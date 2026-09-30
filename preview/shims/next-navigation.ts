/** Preview shim for next/navigation: enough for client components that only read the URL. */
export function useRouter() {
  return {
    push: (url: string) => window.location.assign(url),
    replace: (url: string) => window.location.replace(url),
    refresh: () => undefined,
    back: () => window.history.back(),
    prefetch: () => undefined,
  };
}
export function usePathname(): string {
  return window.location.pathname;
}
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
export function redirect(url: string): never {
  window.location.assign(url);
  throw new Error("redirect");
}
export function notFound(): never {
  throw new Error("notFound");
}
