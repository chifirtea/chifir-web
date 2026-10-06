"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { LogOut, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { hasSupabaseAuth } from "@/lib/env";
import { useUser } from "./useUser";
import { authPath } from "./nextPath";

const ITEM_CLASS =
  "flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] text-fog-2 transition-colors hover:bg-white/5 hover:text-fog focus-visible:bg-white/5 focus-visible:text-fog";

/**
 * HUD account control. Signed out: a small "Sign in" link that returns to the current page.
 * Signed in: an avatar circle (initial) that opens a menu with Account and Sign out.
 * Renders nothing when accounts are off (local build without Supabase).
 * Targets are 44px; the menu sits above the canvas (z-50).
 */
export function AuthMenu({ className }: { className?: string }) {
  const { user, loading } = useUser();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!hasSupabaseAuth) return null;

  if (loading) {
    return (
      <div
        aria-hidden="true"
        className={cn("h-11 w-11 animate-pulse rounded-full bg-white/5", className)}
      />
    );
  }

  if (!user) {
    return (
      <Link
        href={authPath("login", pathname)}
        className={cn(
          "inline-flex h-11 items-center justify-center rounded-xl px-4 font-display text-[15px] font-semibold tracking-tight text-fog-2 transition-colors hover:bg-white/5 hover:text-fog",
          className,
        )}
      >
        Sign in
      </Link>
    );
  }

  const name = user.displayName ?? user.email?.split("@")[0] ?? "You";
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink/90 font-display text-[15px] font-semibold text-sodium shadow-sign backdrop-blur-md transition-colors hover:bg-ink-2",
          open && "bg-ink-2",
        )}
      >
        {initial}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="sign absolute top-[calc(100%+8px)] right-0 z-50 w-60 p-1.5"
        >
          <div className="mb-1 border-b border-line px-3 pt-2 pb-2.5">
            <div className="truncate font-display text-[15px] font-semibold tracking-tight">
              {name}
            </div>
            {user.email ? <div className="truncate text-xs text-fog-3">{user.email}</div> : null}
          </div>
          <Link
            role="menuitem"
            href="/account"
            onClick={() => setOpen(false)}
            className={ITEM_CLASS}
          >
            <UserIcon className="h-4 w-4" aria-hidden="true" />
            Account
          </Link>
          <form method="post" action="/auth/signout">
            <button role="menuitem" type="submit" className={ITEM_CLASS}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
