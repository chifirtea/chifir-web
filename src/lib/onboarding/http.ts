import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { AdminErrorResponse } from "./api";

/** Response helpers for the admin routes: consistent error bodies, never cached. */

export const NO_STORE = { "cache-control": "no-store" } as const;

export function adminJson<T>(body: T, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(body, { status: init.status ?? 200, headers: NO_STORE });
}

export function adminError(
  status: number,
  error: string,
  extra: Omit<AdminErrorResponse, "error"> = {},
): NextResponse {
  return NextResponse.json<AdminErrorResponse>({ error, ...extra }, { status, headers: NO_STORE });
}

/** `application/json`, optionally with parameters (`; charset=utf-8`). */
export const isJsonContentType = (value: string | null): boolean => /^application\/json\s*(;|$)/i.test(value?.trim() ?? "");

/**
 * Parses a JSON body against a strict schema. Only `application/json` is accepted: a `text/plain`
 * or form POST is a CORS "simple request" that any web page can send without a preflight.
 */
export async function parseAdminBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return { ok: false, response: adminError(415, "Send the body as application/json.") };
  }
  let json: unknown = null;
  try {
    json = await req.json();
  } catch {
    json = null;
  }
  if (json === null || typeof json !== "object") {
    return { ok: false, response: adminError(400, "Expected a JSON object body.") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: adminError(400, "Invalid request", {
        issues: z.flattenError(parsed.error),
        problems: parsed.error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

export const DRAFT_ID = /^[A-Za-z0-9_-]{1,64}$/;
