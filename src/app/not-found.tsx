import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-night p-4 text-fog">
      <div className="w-full max-w-md text-center">
        <div className="eyebrow">404</div>
        <h1 className="font-display mt-2 text-4xl font-bold tracking-tight">This street doesn&rsquo;t exist.</h1>
        <p className="mt-3 text-[15px] text-fog-2">Not yet, anyway. Every real place is a short walk from the plaza.</p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            href="/city"
            className="font-display inline-flex h-11 items-center justify-center rounded-xl bg-signal px-5 text-[15px] font-semibold tracking-tight text-night hover:bg-[#ff7053]"
          >
            Walk into the city
          </Link>
          <Link
            href="/"
            className="font-display inline-flex h-11 items-center justify-center rounded-xl border border-line bg-ink-2 px-5 text-[15px] font-semibold tracking-tight text-fog hover:bg-[#2c313c]"
          >
            Front door
          </Link>
        </div>
      </div>
    </main>
  );
}
