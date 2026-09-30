"use client";

import { useEffect } from "react";
import { Drawer } from "@/components/ui";
import { useWorldStore } from "@/engine/store/worldStore";
import { ChatThread } from "./ChatThread";
import { useChatStream } from "./useChatStream";
import { useIsPhone } from "./useIsPhone";

export const CONCIERGE_SUGGESTIONS = [
  "I'm hungry. Something spicy under $25.",
  "Date night, budget $300: dinner, flowers, an outfit.",
  "What's happening tonight?",
  "We're four people with $100.",
];

/**
 * The city concierge. Bound to `worldStore.conciergeOpen`; a `conciergeSeed` (deep link `?ask=`
 * or a HUD shortcut) is sent once when the drawer opens and then cleared. Right-hand drawer on
 * desktop, bottom sheet on phones. Chat history survives closing the drawer for the session.
 */
export function ConciergeDrawer() {
  const open = useWorldStore((s) => s.conciergeOpen);
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
      open={open}
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
