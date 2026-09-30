import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-[13px] text-fog-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="font-display text-[15px] font-semibold tracking-tight text-fog">Chifir</span>
          <span>Demo merchants. Checkout runs in test mode.</span>
        </div>
        <nav className="flex gap-4">
          <Link href="/city" className="hover:text-fog">
            The city
          </Link>
          <Link href="/city?to=district:event-square" className="hover:text-fog">
            Event Square
          </Link>
        </nav>
      </div>
    </footer>
  );
}
