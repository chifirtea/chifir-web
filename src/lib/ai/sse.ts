import type { ChatStreamEvent } from "./actions";

/**
 * Server-sent events helpers shared by the two AI routes (server) and the chat hook (client).
 * Wire format: one `data: <json>\n\n` frame per `ChatStreamEvent`, `: ping` comments as heartbeat.
 */

export const SSE_HEARTBEAT_MS = 15_000;

export function encodeSseEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface SseResponseOptions {
  /** Aborts the producer when the client goes away (pass `request.signal`). */
  signal?: AbortSignal;
  heartbeatMs?: number;
  status?: number;
}

/**
 * Runs `producer` and streams every emitted event to the client. The producer's returned promise
 * ends the stream; a thrown error becomes a friendly `error` event. Emitting after the stream
 * closed is a no-op.
 */
export function sseResponse(
  producer: (emit: (event: ChatStreamEvent) => void, signal: AbortSignal) => Promise<void>,
  options: SseResponseOptions = {},
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onUpstreamAbort = () => abort.abort();
  options.signal?.addEventListener("abort", onUpstreamAbort, { once: true });
  if (options.signal?.aborted) abort.abort();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => write(": ping\n\n"), options.heartbeatMs ?? SSE_HEARTBEAT_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        options.signal?.removeEventListener("abort", onUpstreamAbort);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime (client disconnected).
        }
      };
      abort.signal.addEventListener("abort", close, { once: true });
      const emit = (event: ChatStreamEvent) => write(encodeSseEvent(event));

      producer(emit, abort.signal)
        .catch((err: unknown) => {
          console.error("[ai] stream producer failed", err);
          emit({ type: "error", code: "internal", message: "Something went wrong on our side. Try again." });
        })
        .finally(close);
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: options.status ?? 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

const VALID_TYPES = new Set(["text", "cards", "action", "tool", "done", "error"]);

/**
 * Pure incremental parser for the client. Feed it the accumulated buffer; it returns every
 * complete event and the unparsed remainder (a partial frame) to prepend to the next chunk.
 * Comment lines (heartbeats) and malformed frames are skipped.
 */
export function parseSseChunk(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: ChatStreamEvent[] = [];
  for (const frame of frames) {
    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (dataLines.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(dataLines.join("\n"));
      if (parsed && typeof parsed === "object" && VALID_TYPES.has(String((parsed as { type?: unknown }).type))) {
        events.push(parsed as ChatStreamEvent);
      }
    } catch {
      // Malformed frame: skip rather than break the stream.
    }
  }
  return { events, rest };
}
