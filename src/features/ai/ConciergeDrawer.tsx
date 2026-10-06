"use client";

import { useEffect } from "react";
import { Drawer } from "@/components/ui";
import { useWorldStore } from "@/engine/store/worldStore";
import { ChatThread } from "./ChatThread";
import { useChatStream } from "./useChatStream";
import { useIsPhone } from "./useIsPhone";

export const CONCIERGE_SUGGESTIONS = [
  "Spicy food under $25.",
  "We are two people, budget $60, something healthy.",
  "I need a black hoodie under $150.",
  "Take me somewhere popular.",
];

/**
 * The city concierge. Bound to `worldStore.conciergeOpen`; a `conciergeSeed` (deep link `?ask=`
 * or a HUD shortcut) is sent once when the drawer opens and then cleared. Right-hand drawer on
 * desktop, bottom sheet on phones. Chat history survives closing the drawer for the session.
 *
 * When the AI opens a product sign or a merchant sheet (`open_product` / `open_merchant`), the
 * drawer slides away so that panel is in front, and comes back when it closes; the thread keeps
 * streaming underneath.
 */
export function ConciergeDrawer() {
  const open = useWorldStore((s) => s.conciergeOpen);
  const yielded = useWorldStore((s) => s.focusedProductId !== null || s.merchantPanelId !== null);
  const seed = useWorldStore((s) => s.conciergeSeed);
  const setConciergeOpen = useWorldStore((s) => s.setConciergeOpen);
  const isPhone = useIsPhone();
  const chat = useChatStream("/api/ai/concierge", { scope: "concierge" });
  const { send } = chat;

  useEffect(() => {
    if (!open || !seed) return;
    // Clear first so a re-render during the request cannot send the seed twice.
    setConciergeOpen(true, null);
    void send(seed);
  }, [open, seed, send, setConciergeOpen]);

  return (
    <Drawer
      open={open && !yielded}
      onClose={() => setConciergeOpen(false)}
      eyebrow="City concierge"
      title="What should we do tonight?"
      side={isPhone ? "bottom" : "right"}
      width="min(460px, 100vw)"
    >
      <ChatThread
        messages={chat.messages}
        status={chat.status}
        error={chat.error}
        activeTool={chat.activeTool}
        suggestions={CONCIERGE_SUGGESTIONS}
        onSend={(text) => void send(text)}
        onCancel={chat.cancel}
        assistantName="Concierge"
        placeholder="Ask the city…"
        emptyState={<p>Hungry, shopping, or just curious what&apos;s on? Ask, and I&apos;ll point you to real places you can walk into.</p>}
      />
    </Drawer>
  );
}
