"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWorldStore } from "@/engine/store/worldStore";
import { selectCartCount, useCartStore } from "./cartStore";

const noop = () => () => {};
/** True only after hydration, so the persisted count never mismatches server HTML. */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/** HUD cart button: bag icon, count badge, a short pulse whenever something is added. */
export function CartButton({ className }: { className?: string }) {
  const mounted = useMounted();
  const count = useCartStore(selectCartCount);
  const lastAddedAt = useCartStore((s) => s.lastAddedAt);
  const setCartOpen = useWorldStore((s) => s.setCartOpen);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!lastAddedAt) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 700);
    return () => clearTimeout(t);
  }, [lastAddedAt]);

  const shown = mounted ? count : 0;
  return (
    <button
      type="button"
      onClick={() => setCartOpen(true)}
      aria-label={shown > 0 ? `Open cart, ${shown} ${shown === 1 ? "item" : "items"}` : "Open cart"}
      title="Cart"
      className={cn(
        "sign relative flex h-11 w-11 items-center justify-center text-fog transition-[transform,box-shadow,color] duration-300 hover:text-sodium",
        pulse && "scale-110 text-sodium shadow-glow-signal",
        className,
      )}
    >
      <ShoppingBag className="h-5 w-5" aria-hidden="true" />
      {shown > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "tabular font-display absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1 text-[11px] font-bold text-night",
            pulse && "animate-bounce",
          )}
        >
          {shown > 99 ? "99+" : shown}
        </span>
      ) : null}
    </button>
  );
}
