import { create } from "zustand";
import type { AABB } from "./types";

export type ColliderScope = "street" | "interior";

interface ColliderState {
  scopes: Record<ColliderScope, AABB[]>;
  setColliders: (scope: ColliderScope, colliders: AABB[]) => void;
  clearColliders: (scope: ColliderScope) => void;
}

/**
 * Blocking volumes by scope. Scenes register their colliders on mount and clear on unmount; the
 * player controller reads the active scope's list every frame via `getActiveColliders()`.
 */
export const useColliderStore = create<ColliderState>((set) => ({
  scopes: { street: [], interior: [] },
  setColliders: (scope, colliders) => set((s) => ({ scopes: { ...s.scopes, [scope]: colliders } })),
  clearColliders: (scope) => set((s) => ({ scopes: { ...s.scopes, [scope]: [] } })),
}));

export function getColliders(scope: ColliderScope): AABB[] {
  return useColliderStore.getState().scopes[scope];
}
