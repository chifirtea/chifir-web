"use client";

import { Map as MapIcon } from "lucide-react";
import { ConciergeButton } from "@/features/ai/ConciergeButton";
import { AuthMenu } from "@/features/auth/AuthMenu";
import { CartButton } from "@/features/cart/CartButton";
import { EventHud } from "@/features/events/EventHud";
import { PartyHud } from "@/features/party/PartyHud";
import { useInputStore } from "@/engine/input/inputStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { ControlsHint } from "./ControlsHint";
import { InteractionPrompt } from "./InteractionPrompt";
import { LocationBadge } from "./LocationBadge";
import { useIsTouch } from "./useMediaQuery";
import { WaypointChevron } from "./WaypointChevron";

/**
 * The DOM layer over the canvas: signage, not a dashboard. The container ignores pointer events;
 * every control opts back in, so the world stays draggable between them.
 */
export function Hud() {
  // Touch controls (joystick + run button) live in the bottom 170px; keep the prompt above them.
  const touchStore = useInputStore((s) => s.touch);
  const coarse = useIsTouch();
  const touch = touchStore || coarse;
  const ready = useWorldStore((s) => s.ready);
  return (
    <div
      data-testid="hud"
      data-ready={ready ? "true" : "false"}
      className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between"
      style={{
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingRight: "max(12px, env(safe-area-inset-right))",
        paddingBottom: touch
          ? "max(132px, calc(env(safe-area-inset-bottom) + 120px))"
          : "max(20px, env(safe-area-inset-bottom))",
        paddingLeft: "max(12px, env(safe-area-inset-left))",
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <LocationBadge />
          {/* Wraps on narrow phones rather than pushing the cart off screen. */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <PartyHud className="pointer-events-auto" />
            <PlacesButton />
            <ConciergeButton className="pointer-events-auto" />
            <CartButton className="pointer-events-auto" />
            <AuthMenu className="pointer-events-auto" />
          </div>
        </div>
        <div className="flex justify-center">
          <WaypointChevron />
        </div>
        <div className="flex justify-center">
          <EventHud />
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <ControlsHint />
        <InteractionPrompt />
      </div>
      {ready ? (
        <span data-testid="city-ready" className="sr-only">
          City ready
        </span>
      ) : null}
    </div>
  );
}

function PlacesButton() {
  const setPlacesOpen = useWorldStore((s) => s.setPlacesOpen);
  return (
    <button
      data-testid="places-button"
      type="button"
      onClick={() => setPlacesOpen(true)}
      aria-label="Places and tonight's events"
      title="Places"
      className="sign pointer-events-auto flex h-11 w-11 items-center justify-center text-fog transition-colors hover:text-sodium"
    >
      <MapIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
