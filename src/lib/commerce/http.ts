import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { CommerceErrorResponse } from "./types";

/** Small helpers so every commerce route validates the same way and never leaks internals. */

export function jsonError(
  status: number,
  error: string,
  extra: Omit<CommerceErrorResponse, "error"> = {},
) {
  return NextResponse.json<CommerceErrorResponse>({ error, ...extra }, { status });
}

export const notFound = () => jsonError(404, "Not found");
export const forbidden = () => jsonError(403, "You do not have access to this order.");

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Parses a body with a schema; returns the typed value or a ready 400 response. */
export async function parseBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  const json = await readJson(req);
  if (json === null || typeof json !== "object") {
    return { ok: false, response: jsonError(400, "Expected a JSON object body.") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(400, "Invalid request", { issues: z.flattenError(parsed.error) }),
    };
  }
  return { ok: true, data: parsed.data };
}
