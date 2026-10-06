"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { getCityIndex } from "@/city/cityStore";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { Toast } from "@/features/hud/Toast";
import { useIsPhone } from "@/features/hud/useMediaQuery";
import { track } from "@/lib/analytics/client";
import { selectPartyMemberCount, selectRoomCount, usePresenceStore } from "@/lib/presence/presenceStore";
import { cn } from "@/lib/utils/cn";
import { buildInviteUrl, inviteTargetFor } from "./partyLink";
import { PartyMembers } from "./PartyMembers";
import { usePartyStore } from "./partyStore";
import { acceptJoinOffer, dismissJoinOffer, useParty } from "./useParty";

const PILL =
  "sign pointer-events-auto flex h-11 min-w-11 items-center justify-center gap-1.5 px-3 text-fog transition-colors";
/** The party chip's slot is always this wide, so creating a party moves nothing beside it. */
const CHIP_SLOT = "w-14";
const NUMBER = "tabular font-display text-[14px] font-semibold tracking-tight";

/** Current invite link for the party we are in, aimed at where we stand right now. */
function currentInviteUrl(code: string): string {
  const world = useWorldStore.getState();
  const to = inviteTargetFor(world.location, getCityIndex(), playerRig.x, playerRig.z);
  return buildInviteUrl(window.location.origin, code, to);
}

/**
 * Presence + party in the HUD's right cluster. Wider screens: a people count for the room, an
 * Invite button (creates or reuses the party and shares the link) and a party chip in a slot
 * reserved for it. Phones: one 44px people button (a count badge only when someone else is here,
 * a sodium ring in a party) that opens a sheet holding the members and Invite, so the row keeps
 * room for the cart. Either way the footprint never changes with presence or party state.
 */
export function PartyHud({ className }: { className?: string }) {
  useParty();
  const ready = useWorldStore((s) => s.ready);
  const roomCount = usePresenceStore(selectRoomCount);
  const memberCount = usePresenceStore(selectPartyMemberCount);
  const code = usePartyStore((s) => s.code);
  const hydrated = usePartyStore((s) => s.hydrated);
  const joinOffer = usePartyStore((s) => s.joinOffer);
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; sticky?: boolean } | null>(null);
  // The hidden link mirrors the party's invite URL for tests and "copy again"; it follows the
  // player at a slow tick since `to=` names where we stand.
  const [linkTick, setLinkTick] = useState(0);
  useEffect(() => {
    if (!code || !hydrated) return;
    const t = setInterval(() => setLinkTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [code, hydrated]);
  void linkTick;
  const inviteUrl = code && hydrated && typeof window !== "undefined" ? currentInviteUrl(code) : null;
  const menuId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);

  const closeToast = useCallback(() => setToast(null), []);
  const closeMenu = useCallback(() => setOpen(false), []);

  const invite = useCallback(async () => {
    const party = usePartyStore.getState();
    const created = !party.code;
    const partyCode = party.createOrGet();
    const url = currentInviteUrl(partyCode);
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (created) track("party_created", { partyCode, via: canShare ? "share" : "hud" });
    if (canShare) {
      try {
        await navigator.share({ title: "Walk the city with me", text: "Join me in Chifir", url });
        return;
      } catch (err) {
        // The user closed the share sheet: nothing to report. Anything else: fall back to copy.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast({ message: "Invite link copied. Send it to a friend and they will spawn next to you." });
    } catch {
      setToast({ message: `Copy this link: ${url}`, sticky: true });
    }
  }, []);

  const inParty = hydrated && Boolean(code);
  const others = roomCount - 1;
  const label = `${roomCount} ${roomCount === 1 ? "person" : "people"} here`;
  const partyLabel = `${memberCount} ${memberCount === 1 ? "member" : "members"}`;

  return (
    <div
      data-testid="party-hud"
      data-room-count={roomCount}
      data-party-count={memberCount}
      className={cn("relative flex items-center gap-2", className)}
    >
      {phone ? (
        <button
          ref={anchorRef}
          type="button"
          data-testid="presence-count"
          data-count={roomCount}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={inParty ? `${label}. Your party: ${partyLabel}. Open party` : `${label}. Invite a friend`}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            PILL,
            "relative w-11 px-0 hover:text-sodium",
            inParty && "border-sodium/50 text-sodium",
            open && "bg-white/8",
            !ready && "opacity-0",
          )}
        >
          <Users className="h-5 w-5" aria-hidden="true" />
          {others > 0 ? (
            <span
              aria-hidden="true"
              className={cn(
                NUMBER,
                "absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-sodium px-1 text-[11px] text-ink",
              )}
            >
              {roomCount}
            </span>
          ) : null}
        </button>
      ) : (
        <>
          {/* Reserved: the chip appears here without moving the count or anything to its right. */}
          <div className={cn(CHIP_SLOT, "flex shrink-0 justify-end")}>
            {inParty ? (
              <button
                ref={anchorRef}
                type="button"
                data-testid="party-chip"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={menuId}
                aria-label={`Your party: ${partyLabel}`}
                onClick={() => setOpen((o) => !o)}
                className={cn(PILL, CHIP_SLOT, "border-sodium/40 px-0 text-sodium hover:bg-white/5", open && "bg-white/8")}
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sodium shadow-[0_0_10px_rgba(255,196,107,0.8)]" />
                <span className={NUMBER}>{memberCount}</span>
              </button>
            ) : null}
          </div>
          <div
            data-testid="presence-count"
            data-count={roomCount}
            role="status"
            aria-live="off"
            aria-label={label}
            title={label}
            className={cn(PILL, "select-none text-fog-2", !ready && "opacity-0")}
          >
            <Users className="h-5 w-5" aria-hidden="true" />
            <span className={NUMBER}>{roomCount}</span>
          </div>
          <button
            type="button"
            data-testid="party-invite"
            onClick={() => void invite()}
            aria-label={inParty ? "Invite a friend to your party" : "Invite a friend"}
            title="Invite a friend"
            className={cn(PILL, NUMBER, "hover:text-sodium")}
          >
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            <span>Invite</span>
          </button>
        </>
      )}

      {open && (inParty || phone) ? (
        <PartyMembers
          id={menuId}
          anchorRef={anchorRef}
          onClose={closeMenu}
          onInvite={() => void invite()}
          {...(phone ? { compact: { roomCount } } : {})}
        />
      ) : null}

      {inviteUrl ? (
        <span data-testid="party-invite-link" className="sr-only">
          {inviteUrl}
        </span>
      ) : null}
      <RigPoseProbe />

      {joinOffer ? (
        <Toast
          message={`${joinOffer.name} from your party is in the city now.`}
          action={{ label: "Go to them", onClick: acceptJoinOffer }}
          onClose={dismissJoinOffer}
          durationMs={20_000}
        />
      ) : toast ? (
        <Toast message={toast.message} onClose={closeToast} durationMs={toast.sticky ? 0 : 6000} />
      ) : null}
    </div>
  );
}

/** Visually hidden "x,z" of the player at 2 Hz: lets tests assert where someone spawned. */
function RigPoseProbe() {
  const [pose, setPose] = useState("");
  useEffect(() => {
    const t = setInterval(() => setPose(`${playerRig.x.toFixed(2)},${playerRig.z.toFixed(2)}`), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <span data-testid="rig-pose" className="sr-only">
      {pose}
    </span>
  );
}
