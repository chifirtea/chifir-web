import type { MerchantDraft, MerchantType } from "@/types/domain";
import type {
  AdminErrorResponse,
  DraftListResponse,
  DraftResponse,
  PlacementsResponse,
  PublishResponse,
  SessionResponse,
} from "@/lib/onboarding/api";
import type { Proposal } from "./editor";

/**
 * Browser client for /api/admin/*. Same-origin fetches carry the httpOnly admin cookie; the token
 * itself never lives in page JS after the session call.
 */

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problems: string[] = [],
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new AdminApiError(0, "Network error: is the server running?");
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<AdminErrorResponse>) | null;
  if (!res.ok) {
    throw new AdminApiError(res.status, body?.error ?? `Request failed (${res.status}).`, body?.problems ?? [], body?.code);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export interface DraftEdits {
  proposal?: Proposal;
  placement?: MerchantDraft["placement"] | null;
  reviewerNotes?: string;
  status?: "in_review" | "approved" | "rejected";
}

export const adminApi = {
  startSession: (token: string) => call<SessionResponse>("/api/admin/session", { method: "POST", ...json({ token }) }),
  endSession: () => call<void>("/api/admin/session", { method: "DELETE" }),
  listDrafts: () => call<DraftListResponse>("/api/admin/drafts").then((r) => r.drafts),
  getDraft: (id: string) => call<DraftResponse>(`/api/admin/drafts/${encodeURIComponent(id)}`).then((r) => r.draft),
  extract: (url: string, opts: { allowLocal?: boolean; merchantType?: MerchantType } = {}) =>
    call<DraftResponse>(`/api/admin/drafts/extract${opts.allowLocal ? "?allowLocal=1" : ""}`, {
      method: "POST",
      ...json({ url, ...(opts.merchantType ? { hints: { merchantType: opts.merchantType } } : {}) }),
    }).then((r) => r.draft),
  patchDraft: (id: string, edits: DraftEdits) =>
    call<DraftResponse>(`/api/admin/drafts/${encodeURIComponent(id)}`, { method: "PATCH", ...json(edits) }).then((r) => r.draft),
  publish: (id: string) => call<PublishResponse>(`/api/admin/drafts/${encodeURIComponent(id)}/publish`, { method: "POST" }),
  placements: (draftId: string) => call<PlacementsResponse>(`/api/admin/placements?draftId=${encodeURIComponent(draftId)}`),
};
