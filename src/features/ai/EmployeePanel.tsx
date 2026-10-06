"use client";

import { useState } from "react";
import { MessageCircle, Store, UtensilsCrossed } from "lucide-react";
import { Drawer } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useWorldStore } from "@/engine/store/worldStore";
import { useCityStore } from "@/city/cityStore";
import { inspectProduct } from "@/city/cityActions";
import { ProductList } from "@/features/catalog/ProductList";
import type { AiEmployeePublic, Merchant } from "@/types/domain";
import { ChatThread } from "./ChatThread";
import { useChatStream, type UiMessage } from "./useChatStream";
import { useIsPhone } from "./useIsPhone";

/** Suggestion chips adapted to the kind of place (and a couple of its tags). */
export function employeeSuggestions(merchant: Merchant): string[] {
  if (merchant.tags.includes("flowers")) return ["Something for a date tonight.", "Can it arrive today?", "What's under $60?"];
  switch (merchant.merchantType) {
    case "restaurant":
      return ["What's spiciest?", "Something for two under $40?", "I'm allergic to peanuts."];
    case "retail":
      return ["I need an outfit for a date.", "Do you have this in medium?", "What's new this week?"];
    case "venue":
      return ["What's on tonight?", "How do tickets work?", "Is there a dress code?"];
    default:
      return ["What do you offer?", "How does pickup work?", "Any deals right now?"];
  }
}

/**
 * Talking to a merchant's AI employee. Bound to `worldStore.talkingToMerchantId`. The greeting is
 * local (from the public employee config); everything else streams from `/api/ai/employee`.
 * While a product sign is open (the employee's `open_product`, or "Look" on a card) the panel
 * slides away but stays mounted, so the conversation is still there when the sign closes.
 */
export function EmployeePanel() {
  const merchantId = useWorldStore((s) => s.talkingToMerchantId);
  const yielded = useWorldStore((s) => s.focusedProductId !== null);
  const setTalkingTo = useWorldStore((s) => s.setTalkingTo);
  const index = useCityStore((s) => s.index);
  const isPhone = useIsPhone();
  const merchant = merchantId ? index?.merchantsById[merchantId] : undefined;
  const employee = merchantId ? index?.employeesByMerchant[merchantId] : undefined;

  return (
    <Drawer
      open={merchantId !== null && !yielded}
      onClose={() => setTalkingTo(null)}
      side={isPhone ? "bottom" : "right"}
      width="min(460px, 100vw)"
      eyebrow={merchant?.name ?? "At the counter"}
      title={employee ? employee.name : merchant?.name}
      transparentScrim
    >
      {merchant ? <EmployeeChat key={merchant.id} merchant={merchant} employee={employee} /> : null}
    </Drawer>
  );
}

function EmployeeChat({ merchant, employee }: { merchant: Merchant; employee: AiEmployeePublic | undefined }) {
  const greeting: UiMessage[] = employee
    ? [{ id: `greeting-${merchant.id}`, role: "assistant", text: employee.greeting, local: true }]
    : [];
  const chat = useChatStream("/api/ai/employee", { scope: "employee", merchantId: merchant.id, initialMessages: greeting });
  const [view, setView] = useState<"chat" | "catalog">("chat");
  const isRestaurant = merchant.merchantType === "restaurant";
  const catalogLabel = isRestaurant ? "See the menu" : "See products";
  const CatalogIcon = isRestaurant ? UtensilsCrossed : Store;
  const initial = (employee?.name ?? merchant.name).trim().charAt(0).toUpperCase();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="h-1.5 shrink-0" style={{ background: `linear-gradient(90deg, ${merchant.brand.primary}, ${merchant.brand.secondary} 60%, ${merchant.brand.accent})` }} />
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <div
          className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold"
          style={{ background: merchant.brand.primary, color: merchant.brand.onPrimary }}
          aria-hidden="true"
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-[15px] font-semibold tracking-tight">{employee?.name ?? merchant.name}</p>
          <p className="truncate text-[13px] text-fog-2">{employee ? `${employee.role} · ${merchant.name}` : merchant.tagline ?? merchant.category}</p>
        </div>
        <button
          type="button"
          onClick={() => setView(view === "chat" ? "catalog" : "chat")}
          aria-pressed={view === "catalog"}
          className={cn(
            "font-display inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors",
            view === "catalog" ? "border-sodium/40 bg-sodium/12 text-sodium" : "border-line bg-white/4 text-fog-2 hover:text-fog",
          )}
        >
          {view === "catalog" ? <MessageCircle className="h-4 w-4" /> : <CatalogIcon className="h-4 w-4" />}
          {view === "catalog" ? "Back to chat" : catalogLabel}
        </button>
      </div>
      {view === "chat" ? (
        <ChatThread
          messages={chat.messages}
          status={chat.status}
          error={chat.error}
          activeTool={chat.activeTool}
          suggestions={employeeSuggestions(merchant)}
          onSend={(text) => void chat.send(text)}
          onCancel={chat.cancel}
          assistantName={employee?.name ?? merchant.name}
          accent={merchant.brand.accent}
          placeholder={employee ? `Ask ${employee.name}…` : "Ask…"}
        />
      ) : (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-2">
          <ProductList merchantId={merchant.id} onSelect={(productId) => inspectProduct(productId, "panel")} />
        </div>
      )}
    </div>
  );
}
