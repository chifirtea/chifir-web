import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Frame for the auth pages: a lone lit sign on a dark street. Server-safe (no hooks).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 38% at 50% -4%, rgba(255,196,107,0.16), transparent 70%), radial-gradient(38% 30% at 88% 104%, rgba(255,90,54,0.09), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-[420px]">
        <Link href="/" className="eyebrow mb-4 inline-flex items-center gap-2 hover:text-fog-2">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-signal shadow-glow-signal"
          />
          Chifir · the city
        </Link>
        <section className="sign p-6 sm:p-8">{children}</section>
      </div>
    </main>
  );
}

/** Shown when Supabase is not configured: the city still works, accounts do not. */
export function AccountsOff() {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Accounts are off in this local build
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-fog-2">
        This build runs without Supabase, so there is nothing to sign in to. The city, stores, cart
        and the demo checkout all work without an account.
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-fog-2">
        To turn accounts on, set{" "}
        <code className="rounded bg-white/5 px-1 py-0.5 text-[13px]">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
        and{" "}
        <code className="rounded bg-white/5 px-1 py-0.5 text-[13px]">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>
        . See <span className="text-fog">docs/SETUP.md</span>.
      </p>
      <Link
        href="/city"
        className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-signal px-4 font-display text-[15px] font-semibold tracking-tight text-night shadow-[0_8px_24px_rgba(255,90,54,0.28)] hover:bg-[#ff7053]"
      >
        Back to the city
      </Link>
    </div>
  );
}
