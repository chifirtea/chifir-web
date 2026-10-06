"use client";

import { useEffect, useRef } from "react";
import { LogOut, Navigation, X } from "lucide-react";
import { useCityStore } from "@/city/cityStore";
import { usePresenceStore, type PartyPeer } from "@/lib/presence/presenceStore";
import { parseRoom } from "@/lib/presence/rooms";
import { cn } from "@/lib/utils/cn";
import { usePartyStore } from "./partyStore";
import { goToPartyMember } from "./useParty";

interface Props {
  id: string;
  onClose: () => void;
  onInvite: () => void;
}

/** Where a member is, in words the city uses: a district name or a store. */
function whereIs(member: PartyPeer): string | null {
  const index = useCityStore.getState().index;
  const room = member.room ? parseRoom(member.room) : null;
  if (!index || !room) return null;
  if (room.kind === "district") return index.districtsById[room.id]?.name ?? null;
  if (room.kind === "interior") {
    const parcel = index.parcelsById[room.id];
    const merchant = parcel?.merchantId ? index.merchantsById[parcel.merchantId] : undefined;
    return merchant ? `Inside ${merchant.name}` : null;
  }
  return null;
}

/**
 * Who is in the party and where; "Go to" teleports next to them. A small sign under the party
 * chip; closes on Escape, outside tap or any action.
 */
export function PartyMembers({ id, onClose, onInvite }: Props) {
  const code = usePartyStore((s) => s.code);
  const leave = usePartyStore((s) => s.leave);
  const partyPeers = usePresenceStore((s) => s.partyPeers);
  const myName = usePresenceStore((s) => s.me.name);
  const index = useCityStore((s) => s.index);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Deferred so the tap that opened the sheet does not close it.
    const t = setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (!code) return null;
  const members = Object.values(partyPeers).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      ref={rootRef}
      id={id}
      role="dialog"
      aria-label="Your party"
      data-testid="party-members"
      className="sign pointer-events-auto absolute top-full right-0 z-40 mt-2 w-[min(320px,calc(100vw-24px))] p-2"
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <div>
          <div className="eyebrow">Party</div>
          <div className="font-display text-[15px] font-semibold tracking-tight">
            {members.length + 1} {members.length === 0 ? "person" : "people"} · code{" "}
            <span className="tabular text-sodium">{code}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fog-2 hover:bg-white/8 hover:text-fog"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ul className="mt-2 flex flex-col">
        <li className="flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] text-fog-2">
          <span className="min-w-0 flex-1 truncate">
            {myName} <span className="text-fog-3">(you)</span>
          </span>
        </li>
        {members.map((m) => {
          const where = whereIs(m);
          return (
            <li key={m.id} className="flex h-11 items-center gap-2 rounded-lg pl-3 text-[14px]">
              <span className="min-w-0 flex-1 truncate text-fog">
                {m.name}
                {where ? <span className="text-fog-3"> · {where}</span> : null}
              </span>
              <button
                type="button"
                data-testid="party-goto"
                onClick={() => {
                  if (index && goToPartyMember(m, index)) onClose();
                }}
                disabled={!index}
                className={cn(
                  "font-display flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold tracking-tight text-sodium hover:bg-white/8",
                  !index && "opacity-50",
                )}
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Go to
              </button>
            </li>
          );
        })}
        {members.length === 0 ? (
          <li className="px-3 py-2 text-[13px] text-fog-3">Nobody else yet. Send the link and they will appear here.</li>
        ) : null}
      </ul>

      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => {
            onInvite();
            onClose();
          }}
          className="font-display flex h-11 flex-1 items-center justify-center rounded-full bg-sodium/15 px-4 text-[14px] font-semibold tracking-tight text-sodium hover:bg-sodium/25"
        >
          Invite
        </button>
        <button
          type="button"
          onClick={() => {
            leave();
            onClose();
          }}
          className="flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-fog-2 hover:bg-white/8 hover:text-fog"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Leave
        </button>
      </div>
    </div>
  );
}
