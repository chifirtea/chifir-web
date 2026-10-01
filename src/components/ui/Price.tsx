import { formatCents } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";
import type { CurrencyCode } from "@/types/domain";

export function Price({
  cents,
  currency = "USD",
  compareAtCents,
  className,
}: {
  cents: number;
  currency?: CurrencyCode;
  compareAtCents?: number;
  className?: string;
}) {
  if (cents === 0) {
    return <span className={cn("tabular font-semibold text-mint", className)}>Free</span>;
  }
  return (
    <span className={cn("tabular inline-flex items-baseline gap-2", className)}>
      <span className="font-semibold">{formatCents(cents, currency)}</span>
      {compareAtCents && compareAtCents > cents ? (
        <span className="text-sm text-fog-3 line-through">{formatCents(compareAtCents, currency)}</span>
      ) : null}
    </span>
  );
}
