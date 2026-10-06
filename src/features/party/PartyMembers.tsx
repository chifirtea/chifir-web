"use client";

import { useEffect, useRef, type RefObject } from "react";
import { LogOut, Navigation, UserPlus, X } from "lucide-react";
import { useCityStore } from "@/city/cityStore";
import { usePresenceStore, type PartyPeer } from "@/lib/presence/presenceStore";
import { parseRoom } from "@/lib/presence/rooms";
import { cn } from "@/lib/utils/cn";
import { usePartyStore } from "./partyStore";
import { goToPartyMember } from "./useParty";

interface Props {
  id: string;
  /** The control that toggles this popover; a tap on it toggles, it is not an outside tap. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onInvite: () => void;
  /** Phones fold the people count and Invite into this sheet instead of the HUD row. */
  compact?: { roomCount: number };
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
 * chip (on phones, under the single people button, with the count and Invite folded in); closes
 * on Escape, outside tap or any action.
 */
export function PartyMembers({ id, anchorRef, onClose, onInvite, compact }: Props) {
  const code = usePartyStore((s) => s.code);
  const leave = usePartyStore((s) => s.leave);
  const partyPeers = usePresenceStore((s) => s.partyPeers);
  const myName = usePresenceStore((s) => s.me.name);
  const index = useCityStore((s) => s.index);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
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
  }, [anchorRef, onClose]);

  if (!code && !compact) return null;
  const members = code ? Object.values(partyPeers).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const here = compact ? compact.roomCount : 0;

  return (
    <div
      ref={rootRef}
      id={id}
      role="dialog"
      aria-label={code ? "Your party" : "People here"}
      data-testid="party-members"
      className={cn(
        "sign pointer-events-auto z-40 p-2",
        // Phones: the people button sits mid-row, so the sheet spans the screen under the top bar.
        compact
          ? "fixed inset-x-3 top-[max(68px,calc(env(safe-area-inset-top)+56px))] mx-auto max-w-sm"
          : "absolute top-full right-0 mt-2 w-[min(320px,calc(100vw-24px))]",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <div>
          <div className="eyebrow">{code ? "Party" : "Here now"}</div>
          <div className="font-display text-[15px] font-semibold tracking-tight">
            {code ? (
              <>
                {members.length + 1} {members.length === 0 ? "person" : "people"} · code{" "}
                <span className="tabular text-sodium">{code}</span>
              </>
            ) : here > 1 ? (
              `${here} people in this part of the city`
            ) : (
              "Just you here"
            )}
          </div>
          {code && compact ? (
            <div className="text-[13px] text-fog-3">
              {here} {here === 1 ? "person" : "people"} in this part of the city
            </div>
          ) : null}
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

      {code ? (
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
                    if (index && goToPartyMember(m, index).started) onClose();
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
      ) : (
        <p className="mt-1 px-2 pb-1 text-[13px] text-fog-3">Send a friend a link: they spawn right next to you.</p>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
        <button
          type="button"
          // On phones this is the only Invite; on wider screens the HUD row has its own.
          {...(compact ? { "data-testid": "party-invite" } : {})}
          onClick={() => {
            onInvite();
            onClose();
          }}
          className="font-display flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-sodium/15 px-4 text-[14px] font-semibold tracking-tight text-sodium hover:bg-sodium/25"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite a friend
        </button>
        {code ? (
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
        ) : null}
      </div>
    </div>
  );
}
