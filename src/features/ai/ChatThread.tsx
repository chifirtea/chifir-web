"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Eye, Info, MapPin, Navigation, Plus, Send, Sparkles, Square, Store, Zap } from "lucide-react";
import { Badge, Button, Price, ProductImage, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { AIAction } from "@/lib/ai/actions";
import { formatLaunchTime } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";
import { executeAIAction } from "@/city/cityActions";
import { useCityStore } from "@/city/cityStore";
import { DietaryChips, SpiceFlames } from "@/features/catalog/attributes";
import type { MerchantCard, ProductCard } from "@/types/domain";
import type { ChatError, ChatStatus, UiMessage } from "./useChatStream";

export interface ChatThreadProps {
  messages: UiMessage[];
  status: ChatStatus;
  error?: ChatError;
  activeTool?: string | null;
  /** Shown until the user has sent something. */
  suggestions?: string[];
  onSend: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  /** Name over assistant bubbles ("Concierge", the employee's name). */
  assistantName?: string;
  /** Brand colour for the assistant name. */
  accent?: string;
  emptyState?: ReactNode;
  className?: string;
}

const TOOL_LABEL: Record<string, string> = {
  search_merchants: "Looking at places",
  search_products: "Checking menus",
  get_merchant: "Pulling up details",
  get_events: "Checking what's on",
  navigate: "Plotting a route",
  propose_cart: "Pricing your cart",
  escalate_to_human: "Calling someone over",
  recommend_items: "Picking items",
  recommend: "Picking the best fits",
  highlight_storefront: "Lighting up the door",
  open_merchant: "Opening the place",
  open_product: "Opening the item",
};

/**
 * The chat surface shared by the concierge drawer and the employee panel: message list with cards
 * and actions, a streaming caret, suggestion chips and the composer.
 */
export function ChatThread({
  messages,
  status,
  activeTool,
  suggestions = [],
  onSend,
  onCancel,
  placeholder = "Ask anything…",
  assistantName = "Concierge",
  accent,
  emptyState,
  className,
}: ChatThreadProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const streaming = status === "streaming";
  const hasUserMessage = messages.some((m) => m.role === "user");
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeTool]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && emptyState ? <div className="px-1 text-sm text-fog-2">{emptyState}</div> : null}
        {messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            assistantName={assistantName}
            accent={accent}
            streaming={streaming && m.id === lastId && m.role === "assistant"}
          />
        ))}
        {streaming && activeTool ? (
          <div className="flex items-center gap-2 pl-1 text-xs text-fog-3" aria-live="polite">
            <Spinner className="h-3.5 w-3.5" />
            {TOOL_LABEL[activeTool] ?? "Working on it"}…
          </div>
        ) : null}
        {!hasUserMessage && suggestions.length ? (
          <div className="flex flex-wrap gap-2 pt-1" aria-label="Suggestions">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSend(s)}
                disabled={streaming}
                className="min-h-11 rounded-full border border-line bg-white/4 px-3.5 text-left text-[13px] text-fog-2 transition-colors hover:border-sodium/40 hover:text-fog disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Composer onSend={onSend} onCancel={onCancel} streaming={streaming} placeholder={placeholder} />
    </div>
  );
}

function MessageView({
  message,
  assistantName,
  accent,
  streaming,
}: {
  message: UiMessage;
  assistantName: string;
  accent?: string;
  streaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-signal/30 bg-signal/12 px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  const { merchants = [], products = [] } = message.cards ?? {};
  const showBubble = message.text.length > 0 || streaming;
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="font-display px-1 text-[11px] font-semibold tracking-[0.14em] uppercase" style={accent ? { color: accent } : undefined}>
        <span className={accent ? undefined : "text-sodium"}>{assistantName}</span>
      </div>
      {showBubble ? (
        <div
          className={cn(
            "sign max-w-[92%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-wrap",
            message.error && "border-danger/40 text-danger",
          )}
        >
          {message.text}
          {streaming ? <span className="ml-0.5 inline-block h-[1em] w-[0.55ch] translate-y-[2px] animate-pulse bg-sodium align-baseline" aria-hidden="true" /> : null}
          {streaming && !message.text ? <span className="sr-only">Thinking</span> : null}
        </div>
      ) : null}
      {merchants.length ? (
        <div className="grid w-full gap-2">
          {merchants.map((card) => (
            <MerchantCardView key={card.id} card={card} />
          ))}
        </div>
      ) : null}
      {products.length ? (
        <div className="grid w-full gap-2">
          {products.map((card) => (
            <ProductCardView key={card.id} card={card} />
          ))}
        </div>
      ) : null}
      {message.actions?.length ? (
        <div className="grid w-full gap-2">
          {message.actions.map((action, i) => (
            <ActionCardView key={`${message.id}:${i}`} action={action} executed={message.executed?.[i]} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function priceLevelLabel(level: number | undefined): string | null {
  if (!level) return null;
  return "$".repeat(Math.min(4, Math.max(1, Math.round(level))));
}

export function MerchantCardView({ card }: { card: MerchantCard }) {
  const [confirm, setConfirm] = useState(false);
  const teleport: AIAction = { type: "navigate", mode: "teleport", target: { kind: "merchant", merchantId: card.id }, label: card.name };
  const guide: AIAction = { type: "navigate", mode: "guide", target: { kind: "merchant", merchantId: card.id }, label: card.name };
  const details: AIAction = { type: "open_merchant", merchantId: card.id };
  return (
    <article className="sign w-full overflow-hidden rounded-xl">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${card.brand.primary}, ${card.brand.secondary} 60%, ${card.brand.accent})` }} />
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display truncate text-[15px] font-semibold tracking-tight">{card.name}</h3>
            {card.tagline ? <p className="truncate text-[13px] text-fog-2">{card.tagline}</p> : null}
          </div>
          {card.rating !== undefined ? <span className="tabular shrink-0 text-[13px] text-sodium">★ {card.rating.toFixed(1)}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.openNow === true ? <Badge tone="mint">Open now</Badge> : card.openNow === false ? <Badge>Closed</Badge> : null}
          {card.etaLabel ? <Badge>{card.etaLabel}</Badge> : null}
          {priceLevelLabel(card.priceLevel) ? <Badge>{priceLevelLabel(card.priceLevel)}</Badge> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirm ? (
            <>
              <span className="text-[13px] text-fog-2">Teleport to {card.name}?</span>
              <Button
                size="sm"
                onClick={() => {
                  setConfirm(false);
                  executeAIAction(teleport);
                }}
                leading={<Check className="h-4 w-4" />}
              >
                Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                No
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setConfirm(true)} leading={<Navigation className="h-4 w-4" />}>
                Take me there
              </Button>
              <Button size="sm" variant="secondary" onClick={() => executeAIAction(guide)} leading={<MapPin className="h-4 w-4" />}>
                Guide me
              </Button>
              <Button size="sm" variant="ghost" onClick={() => executeAIAction(details)} leading={<Info className="h-4 w-4" />}>
                Details
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductCardView({ card }: { card: ProductCard }) {
  const brand = useCityStore((s) => s.index?.merchantsById[card.merchantId]?.brand);
  const [added, setAdded] = useState<boolean | null>(null);
  const soldOut = card.inventoryStatus === "out_of_stock";
  // A drop item: visible, not purchasable until its window opens (same rule as pricing).
  const dropsAt = card.availableFrom && clockNow() < Date.parse(card.availableFrom) ? card.availableFrom : null;
  return (
    <article className="sign flex w-full gap-3 rounded-xl p-2.5">
      <ProductImage src={card.imageUrl} alt="" label={card.title} brand={brand} className="h-20 w-20 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display min-w-0 truncate text-[15px] font-semibold tracking-tight">{card.title}</h3>
          <Price cents={card.priceCents} currency={card.currency} className="shrink-0 text-[15px]" />
        </div>
        <p className="truncate text-[13px] text-fog-2">{card.merchantName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {card.spiceLevel ? <SpiceFlames level={card.spiceLevel} /> : null}
          <DietaryChips tags={card.dietary} compact />
          {card.etaLabel ? <Badge>{card.etaLabel}</Badge> : null}
          {dropsAt ? (
            <Badge tone="sodium">Drops at {formatLaunchTime(dropsAt, clockNow())}</Badge>
          ) : soldOut ? (
            <Badge tone="danger">Sold out</Badge>
          ) : card.inventoryStatus === "low_stock" ? (
            <Badge tone="sodium">Low stock</Badge>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => executeAIAction({ type: "open_product", productId: card.id })} leading={<Eye className="h-4 w-4" />}>
            Look
          </Button>
          {dropsAt ? null : (
            <Button
              size="sm"
              disabled={soldOut || added === true}
              onClick={() => setAdded(executeAIAction({ type: "propose_cart", items: [{ productId: card.id, quantity: 1 }] }))}
              leading={added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            >
              {added ? "Added" : "Add"}
            </Button>
          )}
          {added === false ? <span className="text-xs text-fog-3">Choose options first</span> : null}
        </div>
      </div>
    </article>
  );
}

export function ActionCardView({ action, executed }: { action: AIAction; executed?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const merchantName = useCityStore((s) =>
    action.type === "escalate" || action.type === "open_merchant" || action.type === "highlight_storefront"
      ? s.index?.merchantsById[action.merchantId]?.name
      : undefined,
  );
  const productTitle = useCityStore((s) =>
    action.type === "open_product" ? s.index?.productsById[action.productId]?.title : undefined,
  );

  if (action.type === "recommend") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-sodium/30 bg-sodium/10 px-3 py-2 text-[13px] text-sodium" data-testid="ai-recommend">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">
            {action.productIds.length + action.merchantIds.length === 1 ? "My pick" : "My picks"} are above
          </p>
          {action.reason ? <p className="text-fog-2">{action.reason}</p> : null}
        </div>
      </div>
    );
  }
  if (action.type === "highlight_storefront") {
    const teleport: AIAction = { type: "navigate", mode: "teleport", target: { kind: "merchant", merchantId: action.merchantId }, label: action.label };
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/4 px-3 py-2 text-[13px]" data-testid="ai-highlight">
        <Zap className={cn("h-4 w-4 shrink-0", executed === false ? "text-fog-3" : "text-sodium")} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fog">
            {executed === false ? `${merchantName ?? action.label} is not on the street right now.` : `${merchantName ?? action.label}'s door is lit up.`}
          </p>
          {action.reason ? <p className="text-fog-2">{action.reason}</p> : null}
        </div>
        {done ? (
          <span className="text-fog-2">On your way.</span>
        ) : confirm ? (
          <>
            <Button size="sm" onClick={() => setDone(executeAIAction(teleport))} leading={<Check className="h-4 w-4" />}>
              Yes, teleport
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              No
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirm(true)} leading={<Navigation className="h-4 w-4" />}>
            Take me there
          </Button>
        )}
      </div>
    );
  }
  if (action.type === "open_merchant" || action.type === "open_product") {
    const name = action.type === "open_merchant" ? merchantName : productTitle;
    const Icon = action.type === "open_merchant" ? Store : Eye;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/4 px-3 py-2 text-[13px]">
        <Icon className="h-4 w-4 shrink-0 text-sodium" aria-hidden="true" />
        <p className="min-w-0 flex-1 font-medium text-fog">
          {executed === false ? "That one is not in the city right now." : `Opened ${name ?? (action.type === "open_merchant" ? "the place" : "the item")}.`}
        </p>
        {executed !== false ? (
          <Button size="sm" variant="ghost" onClick={() => executeAIAction(action)}>
            Open again
          </Button>
        ) : null}
      </div>
    );
  }

  if (action.type === "propose_cart") {
    return (
      <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px]", executed ? "border-mint/30 bg-mint/10 text-mint" : "border-line bg-white/4 text-fog-2")}>
        <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">{executed ? "Added to your cart" : "Couldn't add that yet — open the item to choose options."}</p>
          {action.note ? <p className="text-fog-2">{action.note}</p> : null}
        </div>
      </div>
    );
  }
  if (action.type === "escalate") {
    return (
      <div className="rounded-xl border border-sodium/30 bg-sodium/10 px-3 py-2 text-[13px] text-sodium">
        Someone from {merchantName ?? "the store"} will follow up.
      </div>
    );
  }
  // navigate
  if (done) {
    return (
      <div className="rounded-xl border border-line bg-white/4 px-3 py-2 text-[13px] text-fog-2">
        {action.mode === "teleport" ? `On your way to ${action.label}.` : `Waypoint set: ${action.label}.`}
      </div>
    );
  }
  if (action.mode === "guide") {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="justify-start"
        onClick={() => setDone(executeAIAction(action))}
        leading={<MapPin className="h-4 w-4" />}
      >
        Guide me to {action.label}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirm ? (
        <>
          <span className="text-[13px] text-fog-2">Teleport to {action.label}?</span>
          <Button size="sm" onClick={() => setDone(executeAIAction(action))} leading={<Check className="h-4 w-4" />}>
            Yes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            No
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => setConfirm(true)} leading={<Navigation className="h-4 w-4" />}>
          Take me there: {action.label}
        </Button>
      )}
    </div>
  );
}

function Composer({
  onSend,
  onCancel,
  streaming,
  placeholder,
}: {
  onSend: (text: string) => void;
  onCancel: () => void;
  streaming: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend(text);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <form
      className="flex items-end gap-2 border-t border-line px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        maxLength={2000}
        placeholder={placeholder}
        disabled={streaming}
        aria-label="Message"
        className="scroll-thin max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-ink-2 px-3.5 py-3 text-[15px] leading-snug placeholder:text-fog-3 focus:border-sodium/50 focus:outline-none disabled:opacity-60"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Stop"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-ink-2 text-fog hover:bg-[#2c313c]"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-signal text-night shadow-[0_8px_24px_rgba(255,90,54,0.28)] transition-opacity hover:bg-[#ff7053] disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
