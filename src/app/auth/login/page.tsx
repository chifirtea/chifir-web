import type { Metadata } from "next";
import { z } from "zod";
import { hasSupabaseAuth } from "@/lib/env";
import { AuthForm } from "@/features/auth/AuthForm";
import { AccountsOff, AuthShell } from "@/features/auth/AuthShell";
import { safeNextPath } from "@/features/auth/nextPath";

export const metadata: Metadata = { title: "Sign in · Chifir" };

type SearchParams = Record<string, string | string[] | undefined>;

const callbackErrorSchema = z.enum(["link", "missing_code"]);
const CALLBACK_ERRORS: Record<z.infer<typeof callbackErrorSchema>, string> = {
  link: "That sign-in link is invalid or has expired. Ask for a new one.",
  missing_code: "That sign-in link was incomplete. Ask for a new one.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = callbackErrorSchema.safeParse(first(params.error));

  return (
    <AuthShell>
      {hasSupabaseAuth ? (
        <AuthForm
          mode="login"
          next={next}
          initialError={error.success ? CALLBACK_ERRORS[error.data] : undefined}
        />
      ) : (
        <AccountsOff />
      )}
    </AuthShell>
  );
}
