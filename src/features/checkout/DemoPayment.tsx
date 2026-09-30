"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import type { CurrencyCode } from "@/types/domain";
import { Button } from "@/components/ui";
import { formatCents } from "@/lib/utils/money";
import type { CommerceErrorResponse, DemoPayResponse } from "@/lib/commerce/types";

export interface DemoPaymentProps {
  orderId: string;
  token: string;
  totalCents: number;
  currency: CurrencyCode;
}

/** The "pay" button of the simulated rail. Clearly labelled: nothing is charged. */
export function DemoPayment({ orderId, token, totalCents, currency }: DemoPaymentProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, token }),
      });
      const data = (await res.json().catch(() => null)) as DemoPayResponse | CommerceErrorResponse | null;
      if (!res.ok || !data || !("ok" in data)) {
        setError((data && "error" in data && data.error) || "Payment could not be recorded. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(`/orders/${orderId}?t=${token}`);
    } catch {
      setError("You appear to be offline. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="demo-pay-title" className="rounded-xl border border-sodium/40 bg-sodium/8 p-4">
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-sodium" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="demo-pay-title" className="font-display text-base font-semibold tracking-tight text-sodium">
            Simulated payment — no money moves
          </h2>
          <p className="mt-1 text-sm text-fog-2">
            This build runs without a payment processor. Pressing pay records the order as paid and starts the (simulated)
            fulfillment so you can follow it on the order page.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="mt-4 w-full" onClick={pay} loading={busy}>
        {busy ? "Recording payment" : `Pay ${formatCents(totalCents, currency)}`}
      </Button>
    </section>
  );
}
