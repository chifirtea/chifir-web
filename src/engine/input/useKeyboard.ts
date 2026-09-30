import { useEffect } from "react";
import { selectInputLocked, useWorldStore } from "@/engine/store/worldStore";
import { useInputStore } from "./inputStore";

/** Physical key codes so WASD works on AZERTY/QWERTZ layouts too. */
const FORWARD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const RUN = new Set(["ShiftLeft", "ShiftRight"]);
const INTERACT = new Set(["KeyE", "Enter", "NumpadEnter"]);
const PREVENT_DEFAULT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Keyboard → input rig. WASD/arrows move, Shift runs, E/Enter interacts. Key-downs are ignored
 * while an overlay owns input or a text field has focus; key-ups are always applied so a key
 * released while a panel was open does not stay stuck down.
 */
export function useKeyboard(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pressed = new Set<string>();
    const input = useInputStore.getState();

    const axis = (pos: Set<string>, neg: Set<string>): number => {
      let v = 0;
      for (const code of pressed) {
        if (pos.has(code)) v += 1;
        else if (neg.has(code)) v -= 1;
      }
      return v > 1 ? 1 : v < -1 ? -1 : v;
    };

    const apply = () => {
      input.setMove(axis(RIGHT, LEFT), axis(FORWARD, BACK));
      input.setRun([...RUN].some((code) => pressed.has(code)));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target) || selectInputLocked(useWorldStore.getState())) return;
      const code = e.code;
      if (INTERACT.has(code)) {
        if (!e.repeat) input.requestInteract();
        e.preventDefault();
        return;
      }
      if (PREVENT_DEFAULT.has(code)) e.preventDefault();
      if (e.repeat || pressed.has(code)) return;
      if (FORWARD.has(code) || BACK.has(code) || LEFT.has(code) || RIGHT.has(code) || RUN.has(code)) {
        pressed.add(code);
        apply();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (pressed.delete(e.code)) apply();
    };

    const reset = () => {
      pressed.clear();
      input.reset();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      reset();
    };
  }, []);
}
