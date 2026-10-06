import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "./actions";
import { encodeSseEvent, parseSseChunk, sseResponse } from "./sse";

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("parseSseChunk", () => {
  it("parses complete frames and keeps the partial tail", () => {
    const a = encodeSseEvent({ type: "text", delta: "Hel" });
    const b = encodeSseEvent({ type: "text", delta: "lo" });
    const partial = 'data: {"type":"done"';
    const { events, rest } = parseSseChunk(a + b + partial);
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
    expect(rest).toBe(partial);
    const next = parseSseChunk(`${rest}}\n\n`);
    expect(next.events).toEqual([{ type: "done" }]);
    expect(next.rest).toBe("");
  });

  it("ignores heartbeat comments, CRLF line endings and malformed frames", () => {
    const buffer = ": ping\r\n\r\ndata: not json\n\ndata: {\"type\":\"bogus\"}\n\ndata: {\"type\":\"tool\",\"name\":\"search_products\",\"status\":\"start\"}\r\n\r\n";
    const { events, rest } = parseSseChunk(buffer);
    expect(events).toEqual([{ type: "tool", name: "search_products", status: "start" }]);
    expect(rest).toBe("");
  });

  it("joins multi-line data fields", () => {
    const { events } = parseSseChunk('data: {"type":"text",\ndata: "delta":"x"}\n\n');
    expect(events).toEqual([{ type: "text", delta: "x" }]);
  });

  it("round-trips every event shape", () => {
    const all: ChatStreamEvent[] = [
      { type: "text", delta: "a\nb" },
      { type: "cards", products: [] },
      { type: "action", action: { type: "navigate", mode: "guide", target: { kind: "district", districtId: "d" }, label: "Food Street" } },
      { type: "tool", name: "navigate", status: "end" },
      { type: "error", code: "refused", message: "no" },
      { type: "done", conversationId: "c1" },
    ];
    const { events } = parseSseChunk(all.map(encodeSseEvent).join(""));
    expect(events).toEqual(all);
  });
});

describe("sseResponse", () => {
  it("streams events with the right headers and closes when the producer resolves", async () => {
    const res = sseResponse(async (emit) => {
      emit({ type: "text", delta: "hi" });
      emit({ type: "done" });
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const body = await readAll(res);
    expect(parseSseChunk(body).events).toEqual([{ type: "text", delta: "hi" }, { type: "done" }]);
  });

  it("emits heartbeats while the producer is idle and a friendly error when it throws", async () => {
    const res = sseResponse(
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("boom");
      },
      { heartbeatMs: 5 },
    );
    const body = await readAll(res);
    expect(body).toContain(": ping\n\n");
    const { events } = parseSseChunk(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", code: "internal" });
  });

  it("aborts the producer when the upstream signal fires", async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const res = sseResponse(
      (emit, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          });
          emit({ type: "text", delta: "x" });
        }),
      { signal: controller.signal },
    );
    controller.abort();
    await readAll(res);
    expect(sawAbort).toBe(true);
  });
});
