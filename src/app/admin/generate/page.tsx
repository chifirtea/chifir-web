import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { features } from "@/lib/env.server";
import { adminPageAccess } from "@/lib/onboarding/auth";
import { localFetchAllowed } from "@/lib/onboarding/env";
import { DRAFT_ID } from "@/lib/onboarding/http";
import { GeneratorApp } from "@/features/admin/GeneratorApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Merchant generator — Chifir admin",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Server shell for the admin generator. Does not exist (404) unless admin is enabled: always on
 * localhost, only with ADMIN_ACCESS_TOKEN in production. Data loads client-side through the
 * gated /api/admin routes, so this page renders no draft content itself.
 */
export default async function GeneratePage({ searchParams }: { searchParams: SearchParams }) {
  if (!features.admin) notFound();
  const sp = await searchParams;
  const access = await adminPageAccess();
  const draft = first(sp.draft);
  return (
    <GeneratorApp
      needsToken={access.tokenRequired && !access.authenticated}
      tokenRequired={access.tokenRequired}
      aiConfigured={features.ai}
      allowLocal={localFetchAllowed(first(sp.allowLocal) === "1")}
      {...(draft && DRAFT_ID.test(draft) ? { initialDraftId: draft } : {})}
    />
  );
}
