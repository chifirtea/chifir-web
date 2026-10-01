"use client";

import { clockHeaders } from "@/lib/time/clientClock";
import { useCallback, useEffect, useRef, useState } from "react";
import { autoExecutes, type AIAction, type ChatRequest, type ChatScope, type ChatStreamEvent } from "@/lib/ai/actions";
import { parseSseChunk } from "@/lib/ai/sse";
import { validateAIAction } from "@/lib/ai/validateAction";
import { track } from "@/lib/analytics/client";
import { randomId } from "@/lib/utils/ids";
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_TOTAL_CHARS,
} from "@/lib/validation/ai";
import { useWorldStore } from "@/engine/store/worldStore";
import { useCartStore } from "@/features/cart/cartStore";
import { executeAIAction } from "@/city/cityActions";
import { getCityIndex } from "@/city/cityStore";
import type { MerchantCard, ProductCard } from "@/types/domain";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: { merchants?: MerchantCard[]; products?: ProductCard[] };
  actions?: AIAction[];
  /** Index into `actions` -> whether the auto-executed action succeeded (see `autoExecutes`). */
  executed?: Record<number, boolean>;
  toolsUsed?: string[];
  /** The turn ended in an error; `text` holds the friendly message when nothing was streamed. */
  error?: boolean;
  /** Not sent to the server (e.g. the employee's local greeting). */
  local?: boolean;
}

export type ChatStatus = "idle" | "streaming" | "error";
export type ChatErrorCode = Extract<ChatStreamEvent, { type: "error" }>["code"];

export interface ChatError {
  code: ChatErrorCode;
  message: string;
}

export interface UseChatStreamOptions {
  scope: ChatScope;
  merchantId?: string;
  /** Rendered immediately and kept out of the request history when `local` is set. */
  initialMessages?: UiMessage[];
}

export interface UseChatStreamResult {
  messages: UiMessage[];
  send: (text: string) => Promise<void>;
  status: ChatStatus;
  error?: ChatError;
  cancel: () => void;
  /** Tool currently running on the server, for a "Searching…" hint. */
  activeTool: string | null;
}

const FRIENDLY: Record<number, string> = {
  400: "That message could not be sent. Try rephrasing it.",
  404: "That store is not open in the city right now.",
  429: "You're moving fast. Give it a few seconds and try again.",
  503: "The concierge is off duty right now. Try again a little later.",
};

/** ISO 8601 with the device's UTC offset, e.g. 2026-09-30T19:12:00-07:00. */
export function localIsoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

/** Sliding window: the most recent turns that fit the server's count and character caps. */
export function windowHistory(messages: UiMessage[], next: string): ChatRequest["messages"] {
  const history = messages
    .filter((m) => !m.local && !m.error && m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text.slice(0, MAX_CHAT_MESSAGE_CHARS) }));
  const out = [
    ...history.slice(-(MAX_CHAT_MESSAGES - 1)),
    { role: "user" as const, content: next.slice(0, MAX_CHAT_MESSAGE_CHARS) },
  ];
  while (out.length > 1 && out.reduce((n, m) => n + m.content.length, 0) > MAX_CHAT_TOTAL_CHARS)
    out.shift();
  return out;
}

function mergeCards(
  current: UiMessage["cards"],
  incoming: Extract<ChatStreamEvent, { type: "cards" }>,
): UiMessage["cards"] {
  const merchants = [...(current?.merchants ?? [])];
  for (const m of incoming.merchants ?? [])
    if (!merchants.some((x) => x.id === m.id)) merchants.push(m);
  const products = [...(current?.products ?? [])];
  for (const p of incoming.products ?? [])
    if (!products.some((x) => x.id === p.id)) products.push(p);
  return {
    ...(merchants.length ? { merchants } : {}),
    ...(products.length ? { products } : {}),
  };
}

export function useChatStream(
  endpoint: string,
  options: UseChatStreamOptions,
): UseChatStreamResult {
  const { scope, merchantId } = options;
  const [messages, setMessages] = useState<UiMessage[]>(() => options.initialMessages ?? []);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<ChatError | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const messagesRef = useRef<UiMessage[]>(options.initialMessages ?? []);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const patchAssistant = useCallback((id: string, patch: (m: UiMessage) => UiMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  }, []);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = performance.now();
      const userMessage: UiMessage = { id: randomId("u"), role: "user", text };
      const assistantId = randomId("a");
      const toolsUsed: string[] = [];
      let ok = false;

      const history = windowHistory(messagesRef.current, text);
      const world = useWorldStore.getState();
      const cartLines = useCartStore
        .getState()
        .lines.slice(0, 50)
        .map((l) => ({ productId: l.productId, quantity: Math.min(99, Math.max(1, l.quantity)) }));
      const body: ChatRequest = {
        messages: history,
        context: {
          location: world.location,
          cart: { lines: cartLines },
          localTime: localIsoWithOffset(new Date()),
        },
        ...(merchantId ? { merchantId } : {}),
        ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
      };

      setError(undefined);
      setStatus("streaming");
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", text: "" },
      ]);
      track("ai_message_sent", {
        scope,
        ...(merchantId ? { merchantId } : {}),
        chars: text.length,
      });

      const fail = (err: ChatError) => {
        setError(err);
        setStatus("error");
        patchAssistant(assistantId, (m) => ({ ...m, error: true, text: m.text || err.message }));
      };

      const apply = (event: ChatStreamEvent) => {
        switch (event.type) {
          case "text":
            patchAssistant(assistantId, (m) => ({ ...m, text: m.text + event.delta }));
            break;
          case "cards":
            patchAssistant(assistantId, (m) => ({ ...m, cards: mergeCards(m.cards, event) }));
            break;
          case "action": {
            // Every id is checked against the city index before anything runs; an action that
            // names something not in the city is dropped and counted, never executed.
            const verdict = validateAIAction(event.action, getCityIndex());
            if (!verdict.ok) {
              track("ai_action_executed", { action: event.action.type, accepted: false });
              break;
            }
            const action = verdict.action;
            // Panels, highlights, picks and server-priced cart proposals run on arrival, exactly
            // once; teleports keep their one-tap confirm chip.
            const executed = autoExecutes(action) ? executeAIAction(action) : undefined;
            patchAssistant(assistantId, (m) => {
              const index = m.actions?.length ?? 0;
              return {
                ...m,
                actions: [...(m.actions ?? []), action],
                ...(executed !== undefined
                  ? { executed: { ...(m.executed ?? {}), [index]: executed } }
                  : {}),
              };
            });
            break;
          }
          case "tool":
            if (event.status === "start") {
              toolsUsed.push(event.name);
              setActiveTool(event.name);
            } else {
              setActiveTool(null);
            }
            break;
          case "done":
            ok = true;
            if (event.conversationId) conversationIdRef.current = event.conversationId;
            break;
          case "error":
            fail({ code: event.code, message: event.message });
            break;
        }
      };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            ...clockHeaders(),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          let code: ChatErrorCode =
            res.status === 429
              ? "rate_limited"
              : res.status === 503
                ? "unavailable"
                : res.status === 400
                  ? "bad_request"
                  : "internal";
          let message = FRIENDLY[res.status] ?? "Something went wrong on our side. Try again.";
          try {
            const data = (await res.json()) as Partial<ChatError>;
            if (data.code) code = data.code;
            if (data.message) message = data.message;
          } catch {
            // Non-JSON error body: keep the friendly default.
          }
          fail({ code, message });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) apply(event);
        }
        const tail = parseSseChunk(`${buffer}\n\n`);
        for (const event of tail.events) apply(event);
        if (!ok) {
          setStatus((s) => (s === "error" ? s : "idle"));
        } else {
          setStatus("idle");
          patchAssistant(assistantId, (m) => ({ ...m, toolsUsed: [...toolsUsed] }));
        }
      } catch (err) {
        if (controller.signal.aborted) {
          setStatus("idle");
          patchAssistant(assistantId, (m) => (m.text ? m : { ...m, text: "Stopped." }));
        } else {
          console.error("[ai] chat stream failed", err);
          fail({ code: "internal", message: "Lost the connection. Try again." });
        }
      } finally {
        abortRef.current = null;
        setActiveTool(null);
        track("ai_response_received", {
          scope,
          ...(merchantId ? { merchantId } : {}),
          ms: Math.round(performance.now() - startedAt),
          tools: [...toolsUsed],
          ok,
        });
      }
    },
    [endpoint, merchantId, patchAssistant, scope],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, send, status, ...(error ? { error } : {}), cancel, activeTool };
}
