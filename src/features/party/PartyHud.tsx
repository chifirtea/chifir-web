"use client";

import { useCallback, useEffect, useId, useState } from "react";
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
import { useParty } from "./useParty";

const PILL =
  "sign pointer-events-auto flex h-11 min-w-11 items-center justify-center gap-1.5 px-3 text-fog transition-colors";

/** Current invite link for the party we are in, aimed at where we stand right now. */
function currentInviteUrl(code: string): string {
  const world = useWorldStore.getState();
  const to = inviteTargetFor(world.location, getCityIndex(), playerRig.x, playerRig.z);
  return buildInviteUrl(window.location.origin, code, to);
}

/**
 * Presence + party in the HUD's right cluster: a people count for the room, an Invite button
 * (creates or reuses the party and shares the link), and a party chip that opens the member list.
 * All controls are 44px tall so the cluster never shifts.
 */
export function PartyHud({ className }: { className?: string }) {
  useParty();
  const ready = useWorldStore((s) => s.ready);
  const roomCount = usePresenceStore(selectRoomCount);
  const memberCount = usePresenceStore(selectPartyMemberCount);
  const code = usePartyStore((s) => s.code);
  const hydrated = usePartyStore((s) => s.hydrated);
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
  const label = `${roomCount} ${roomCount === 1 ? "person" : "people"} here`;

  return (
    <div className={cn("relative flex items-center gap-2", className)}>
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
        <span className="tabular font-display text-[14px] font-semibold tracking-tight">{roomCount}</span>
      </div>

      {inParty ? (
        <button
          type="button"
          data-testid="party-chip"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Your party: ${memberCount} ${memberCount === 1 ? "member" : "members"}`}
          onClick={() => setOpen((o) => !o)}
          className={cn(PILL, "border-sodium/40 text-sodium hover:bg-white/5", open && "bg-white/8")}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sodium shadow-[0_0_10px_rgba(255,196,107,0.8)]" />
          <span className="tabular font-display text-[14px] font-semibold tracking-tight">{memberCount}</span>
        </button>
      ) : null}

      <button
        type="button"
        data-testid="party-invite"
        onClick={() => void invite()}
        aria-label={inParty ? "Invite a friend to your party" : "Invite a friend"}
        title="Invite a friend"
        className={cn(PILL, "font-display text-[14px] font-semibold tracking-tight hover:text-sodium", phone && "w-11 px-0")}
      >
        <UserPlus className="h-5 w-5" aria-hidden="true" />
        {phone ? null : <span>Invite</span>}
      </button>

      {open && inParty ? <PartyMembers id={menuId} onClose={closeMenu} onInvite={() => void invite()} /> : null}

      {inviteUrl ? (
        <span data-testid="party-invite-link" className="sr-only">
          {inviteUrl}
        </span>
      ) : null}
      <RigPoseProbe />

      {toast ? (
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
