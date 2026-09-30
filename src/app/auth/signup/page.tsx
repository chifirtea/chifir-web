import type { Metadata } from "next";
import { hasSupabaseAuth } from "@/lib/env";
import { AuthForm } from "@/features/auth/AuthForm";
import { AccountsOff, AuthShell } from "@/features/auth/AuthShell";
import { safeNextPath } from "@/features/auth/nextPath";

export const metadata: Metadata = { title: "Create an account · Chifir" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));

  return (
    <AuthShell>
      {hasSupabaseAuth ? <AuthForm mode="signup" next={next} /> : <AccountsOff />}
    </AuthShell>
  );
}
