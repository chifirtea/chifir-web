"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { track } from "@/lib/analytics/client";

export default function CityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    track("error_client", {
      message: String(error?.message ?? error).slice(0, 500),
      ...(error?.stack ? { stack: error.stack.slice(0, 2000) } : {}),
      where: "city_route",
    });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-night p-4 text-fog">
      <div className="sign w-full max-w-sm p-6">
        <div className="eyebrow">Sorry</div>
        <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight">
          The city hit a problem.
        </h1>
        <p className="mt-2 text-[14px] text-fog-2">
          Nothing was charged. Reloading usually fixes it.
        </p>
        {error?.digest ? (
          <p className="tabular mt-2 text-[11px] text-fog-3">Ref {error.digest}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => window.location.reload()} className="flex-1">
            Reload
          </Button>
          <Button variant="secondary" onClick={reset} className="flex-1">
            Try again
          </Button>
        </div>
        <Link
          href="/"
          className="mt-4 inline-block text-[13px] text-fog-3 underline-offset-4 hover:text-fog hover:underline"
        >
          Back to the front door
        </Link>
      </div>
    </main>
  );
}
