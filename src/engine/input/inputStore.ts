import { create } from "zustand";

export interface MoveVector {
  /** Strafe, -1 (left) .. 1 (right). */
  x: number;
  /** Forward, -1 (back) .. 1 (forward). */
  y: number;
}

export interface LookDelta {
  dx: number;
  dy: number;
}

/**
 * High-frequency input, mutated in place by the keyboard hook / virtual joystick and read every
 * frame by the player controller and camera. Never goes through React state.
 */
export interface InputRig {
  move: MoveVector;
  /** Look pixels accumulated since the camera last consumed them. */
  look: LookDelta;
  /** Wheel/pinch zoom accumulated since the camera last consumed it (positive = zoom out). */
  zoom: number;
  run: boolean;
}

export const inputRig: InputRig = {
  move: { x: 0, y: 0 },
  look: { dx: 0, dy: 0 },
  zoom: 0,
  run: false,
};

const lookScratch: LookDelta = { dx: 0, dy: 0 };

export interface InputState {
  /** Same object as `inputRig.move`; mutated in place, never replaced. */
  move: MoveVector;
  /** Same object as `inputRig.look`; mutated in place, never replaced. */
  look: LookDelta;
  run: boolean;
  /** Bumped on every interact request (E / Enter / tap). The HUD subscribes and acts. */
  interactCount: number;
  /** True once a touch pointer layer is active; the HUD uses it to word its prompts. */
  touch: boolean;

  setMove: (x: number, y: number) => void;
  addLook: (dx: number, dy: number) => void;
  /** Returns the accumulated look delta and zeroes it. The result object is reused; copy it if kept. */
  consumeLook: () => LookDelta;
  addZoom: (delta: number) => void;
  /** Returns the accumulated zoom delta and zeroes it. */
  consumeZoom: () => number;
  setRun: (run: boolean) => void;
  requestInteract: () => void;
  setTouch: (touch: boolean) => void;
  /** Zeroes movement and look and clears run (window blur, input lock). */
  reset: () => void;
}

export const useInputStore = create<InputState>((set, get) => ({
  move: inputRig.move,
  look: inputRig.look,
  run: false,
  interactCount: 0,
  touch: false,

  setMove: (x, y) => {
    inputRig.move.x = x;
    inputRig.move.y = y;
  },
  addLook: (dx, dy) => {
    inputRig.look.dx += dx;
    inputRig.look.dy += dy;
  },
  consumeLook: () => {
    lookScratch.dx = inputRig.look.dx;
    lookScratch.dy = inputRig.look.dy;
    inputRig.look.dx = 0;
    inputRig.look.dy = 0;
    return lookScratch;
  },
  addZoom: (delta) => {
    inputRig.zoom += delta;
  },
  consumeZoom: () => {
    const z = inputRig.zoom;
    inputRig.zoom = 0;
    return z;
  },
  setRun: (run) => {
    inputRig.run = run;
    if (get().run !== run) set({ run });
  },
  requestInteract: () => set((s) => ({ interactCount: s.interactCount + 1 })),
  setTouch: (touch) => {
    if (get().touch !== touch) set({ touch });
  },
  reset: () => {
    inputRig.move.x = 0;
    inputRig.move.y = 0;
    inputRig.look.dx = 0;
    inputRig.look.dy = 0;
    inputRig.zoom = 0;
    inputRig.run = false;
    if (get().run) set({ run: false });
  },
}));
