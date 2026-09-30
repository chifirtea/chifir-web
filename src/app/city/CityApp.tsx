"use client";

// Template registries are populated by side effect; import them before anything resolves a pose.
import "@/engine/storefront/templates";
import "@/engine/interior/templates";

import { useCallback, useEffect, useState } from "react";
import { CityScene } from "@/city/CityScene";
import { InteriorScene } from "@/city/InteriorScene";
import { useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { parseDeepLinkTarget, resolveNavTarget } from "@/city/navigation";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { CityCanvas } from "@/engine/canvas/CityCanvas";
import { VirtualJoystick } from "@/engine/input/VirtualJoystick";
import { HotspotScanner } from "@/engine/interaction/HotspotScanner";
import { WaypointBeacon } from "@/engine/navigation/WaypointBeacon";
import { Player } from "@/engine/player/Player";
import { setRigPose } from "@/engine/player/playerRig";
import { useWorldStore, type PlayerPose } from "@/engine/store/worldStore";
import { Fade } from "@/engine/transitions/Fade";
import { ConciergeDrawer } from "@/features/ai/ConciergeDrawer";
import { EmployeePanel } from "@/features/ai/EmployeePanel";
import { AnalyticsProvider } from "@/features/analytics/AnalyticsProvider";
import { ErrorBoundary } from "@/features/analytics/ErrorBoundary";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { ProductPanel } from "@/features/catalog/ProductPanel";
import { DebugBridge } from "@/features/hud/DebugBridge";
import { Hud } from "@/features/hud/Hud";
import { PlacesPanel } from "@/features/hud/PlacesPanel";
import { Toast } from "@/features/hud/Toast";
import { track } from "@/lib/analytics/client";
import type { CitySnapshot } from "@/lib/data/types";

export interface CityAppProps {
  snapshot: CitySnapshot;
  /** `?to=` deep link: merchant slug, or `district:`/`event:`/`parcel:` prefixed. */
  deepLinkTo?: string;
  /** `?ask=` deep link: opens the concierge with this text once the city is ready. */
  ask?: string;
  /** `?checkout=cancelled` after a Stripe cancel: shows a small notice. */
  checkout?: string;
}

/** Fallback if the loader never reports ready (e.g. a silent WebGL failure): reveal the HUD anyway. */
const LOADER_TIMEOUT_MS = 15_000;
const LOADER_FADE_MS = 700;

let lastDeepLinkTrack: { key: string; at: number } | null = null;

function defaultSpawn(index: CityIndex): PlayerPose {
  const districts = [...index.snapshot.districts].sort((a, b) => a.sortOrder - b.sortOrder);
  return districts.find((d) => d.spawnPoint)?.spawnPoint ?? { x: 0, z: 0, yaw: 0 };
}

/** Runs once, synchronously, before any child mounts: seeds the stores and places the player. */
function initCity(snapshot: CitySnapshot, deepLinkTo: string | undefined): void {
  const city = useCityStore.getState();
  city.setSnapshot(snapshot);
  const index = useCityStore.getState().index;
  const world = useWorldStore.getState();

  let pose: PlayerPose | null = null;
  let targetKind: string | null = null;
  if (index && deepLinkTo) {
    const target = parseDeepLinkTarget(deepLinkTo, index);
    if (target) {
      try {
        const resolved = resolveNavTarget(target, index);
        if (resolved) {
          pose = resolved.pose;
          targetKind = target.kind;
        }
      } catch (err) {
        console.warn("[city] could not resolve deep link", deepLinkTo, err);
      }
    }
  }
  if (!pose && index) pose = defaultSpawn(index);

  setRigPose(pose ?? { x: 0, z: 0, yaw: 0 });
  world.resetTransition();
  world.closeAllPanels();
  world.setWaypoint(null);
  world.setActiveHotspot(null);
  world.setLocation({ kind: "street" });
  world.setReady(false);

  if (targetKind) {
    // StrictMode runs initializers twice in development; report the deep link once.
    const key = `${snapshot.generatedAt}|${deepLinkTo}`;
    const now = Date.now();
    if (!lastDeepLinkTrack || lastDeepLinkTrack.key !== key || now - lastDeepLinkTrack.at > 1000) {
      lastDeepLinkTrack = { key, at: now };
      track("teleport", { targetKind, source: "deep_link" });
    }
  }
}

export function CityApp({ snapshot, deepLinkTo, ask, checkout }: CityAppProps) {
  useState(() => {
    initCity(snapshot, deepLinkTo);
    return true;
  });

  const location = useWorldStore((s) => s.location);
  const ready = useWorldStore((s) => s.ready);
  const setConciergeOpen = useWorldStore((s) => s.setConciergeOpen);
  const setPlacesOpen = useWorldStore((s) => s.setPlacesOpen);
  const setCartOpen = useWorldStore((s) => s.setCartOpen);

  // Loading screen: fade out on ready, unmount after the fade; give up waiting after a while.
  const [loaderMounted, setLoaderMounted] = useState(true);
  const [loaderTimedOut, setLoaderTimedOut] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setLoaderMounted(false), LOADER_FADE_MS);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setLoaderTimedOut(true), LOADER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  // `?ask=` opens the concierge with the question once the world is up.
  useEffect(() => {
    if (!ask || !ready) return;
    setConciergeOpen(true, ask);
  }, [ask, ready, setConciergeOpen]);

  // `?checkout=cancelled`: one quiet notice, then clean the URL so a reload does not repeat it.
  const [toast, setToast] = useState<string | null>(
    checkout === "cancelled" ? "Checkout cancelled. Your cart is still here." : null,
  );
  useEffect(() => {
    if (checkout !== "cancelled") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // ignore
    }
  }, [checkout]);
  const closeToast = useCallback(() => setToast(null), []);

  const reload = () => window.location.reload();

  return (
    <div className="fixed inset-0 overflow-hidden bg-night text-fog overscroll-none">
      <AnalyticsProvider>
        <ErrorBoundary
          where="canvas"
          onError={() => setLoaderMounted(false)}
          fallback={
            <CanvasCrashCard
              onReload={reload}
              onBrowse={() => {
                setLoaderMounted(false);
                setPlacesOpen(true);
              }}
            />
          }
        >
          <CityCanvas>
            {location.kind === "street" ? (
              <CityScene />
            ) : (
              <InteriorScene merchantId={location.merchantId} />
            )}
            <Player />
            <HotspotScanner />
            <WaypointBeacon />
          </CityCanvas>
        </ErrorBoundary>

        <VirtualJoystick />
        <Hud />
        {process.env.NODE_ENV !== "production" ? <DebugBridge /> : null}

        <ProductPanel />
        <CartDrawer />
        <ConciergeDrawer />
        <EmployeePanel />
        <PlacesPanel />

        <Fade />

        {toast ? (
          <Toast
            message={toast}
            action={{
              label: "Open cart",
              onClick: () => {
                closeToast();
                setCartOpen(true);
              },
            }}
            onClose={closeToast}
          />
        ) : null}

        {loaderMounted ? <LoadingScreen hidden={ready || loaderTimedOut} /> : null}
      </AnalyticsProvider>
    </div>
  );
}

function CanvasCrashCard({ onReload, onBrowse }: { onReload: () => void; onBrowse: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="sign w-full max-w-sm p-6">
        <div className="eyebrow">Sorry</div>
        <h2 className="font-display mt-1 text-xl font-semibold tracking-tight">
          The 3D view crashed on this device.
        </h2>
        <p className="mt-2 text-[14px] text-fog-2">
          You can reload, or browse every place in the city as a list instead.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button onClick={onReload} className="flex-1">
            Reload
          </Button>
          <Button variant="secondary" onClick={onBrowse} className="flex-1">
            Browse places instead
          </Button>
        </div>
      </div>
    </div>
  );
}
