"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { z } from "zod";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { setAnalyticsUser, track } from "@/lib/analytics/client";
import { authPath, safeNextPath } from "./nextPath";
import type { AuthFlow } from "./authEvent";

export type AuthMode = "login" | "signup";

export interface AuthFormProps {
  mode: AuthMode;
  /** Sanitised return path (the page validates it). */
  next?: string;
  /** Message carried over from a failed callback, shown above the form. */
  initialError?: string;
}

type FieldName = "email" | "password" | "displayName";
type FieldErrors = Partial<Record<FieldName, string>>;
type Pending = null | "password" | "magic_link";
type Phase = { kind: "form" } | { kind: "sent"; email: string; reason: "magic_link" | "confirm" };

const emailSchema = z.email("Enter a valid email address.");
const passwordSchema = z
  .string("Enter a password.")
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.");
const displayNameSchema = z
  .string("Enter a display name.")
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(40, "Use at most 40 characters.");

const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
const signupSchema = loginSchema.extend({ displayName: displayNameSchema });
const magicLinkSchema = z.object({ email: emailSchema });

const COPY: Record<
  AuthMode,
  {
    title: string;
    lede: string;
    submit: string;
    submitting: string;
    switchPrompt: string;
    switchLabel: string;
  }
> = {
  login: {
    title: "Sign in",
    lede: "Pick up where you left off: orders, rewards and your city level.",
    submit: "Sign in",
    submitting: "Signing in…",
    switchPrompt: "New here?",
    switchLabel: "Create an account",
  },
  signup: {
    title: "Create an account",
    lede: "Keep your orders, digital twins and city level in one place.",
    submit: "Create account",
    submitting: "Creating account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
  },
};

function issuesToFieldErrors(issues: z.core.$ZodIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "email" || field === "password" || field === "displayName") {
      if (!errors[field]) errors[field] = issue.message;
    }
  }
  return errors;
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password did not match.";
  if (m.includes("email not confirmed"))
    return "Confirm your email first. Check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "That email already has an account. Sign in instead.";
  }
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("signups not allowed")) return "Sign-ups are closed right now.";
  if (m.includes("password")) return message;
  if (m.includes("network") || m.includes("fetch"))
    return "Could not reach the sign-in service. Check your connection.";
  return "Something went wrong. Try again.";
}

function Field({
  label,
  error,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = input.id ?? input.name;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cn(
          "h-11 w-full rounded-xl border bg-night/60 px-3.5 text-[15px] text-fog placeholder:text-fog-3 focus:outline-none",
          error ? "border-danger/60 focus:border-danger" : "border-line focus:border-sodium/60",
        )}
        {...input}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-fog-3">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Email + password sign-in / sign-up with a magic-link alternative. Styled as a lit sign:
 * display headline, one primary action, quiet secondary paths.
 */
export function AuthForm({ mode, next, initialError }: AuthFormProps) {
  const router = useRouter();
  const target = safeNextPath(next);
  const copy = COPY[mode];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(initialError);
  const [pending, setPending] = useState<Pending>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const callbackUrl = (flow?: AuthFlow) => {
    const url = new URL("/auth/callback", window.location.origin);
    url.searchParams.set("next", target);
    if (flow) url.searchParams.set("flow", flow);
    return url.toString();
  };

  const finish = (userId: string) => {
    setAnalyticsUser(userId);
    router.replace(target);
    router.refresh();
  };

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setFormError(undefined);

    const parsed =
      mode === "signup"
        ? signupSchema.safeParse({ email, password, displayName })
        : loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setFieldErrors({});

    const supabase = getBrowserSupabase();
    if (!supabase) {
      setFormError("Accounts are off in this build.");
      return;
    }

    setPending("password");
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error || !data.user) {
          setFormError(friendlyAuthError(error?.message ?? ""));
          return;
        }
        track("login", { method: "password" });
        finish(data.user.id);
        return;
      }

      const name = "displayName" in parsed.data ? parsed.data.displayName : "";
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: { data: { display_name: name }, emailRedirectTo: callbackUrl() },
      });
      if (error || !data.user) {
        setFormError(friendlyAuthError(error?.message ?? ""));
        return;
      }
      track("signup", { method: "password" });
      if (data.session) {
        finish(data.user.id);
        return;
      }
      // Email confirmation is on: the callback route finishes the session.
      setPhase({ kind: "sent", email: parsed.data.email, reason: "confirm" });
    } catch (err) {
      setFormError(friendlyAuthError(err instanceof Error ? err.message : ""));
    } finally {
      setPending(null);
    }
  }

  async function sendMagicLink() {
    if (pending) return;
    setFormError(undefined);
    const parsed = magicLinkSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    if (mode === "signup") {
      const nameCheck = displayNameSchema.safeParse(displayName);
      if (!nameCheck.success) {
        setFieldErrors({
          displayName: nameCheck.error.issues[0]?.message ?? "Enter a display name.",
        });
        return;
      }
    }
    setFieldErrors({});

    const supabase = getBrowserSupabase();
    if (!supabase) {
      setFormError("Accounts are off in this build.");
      return;
    }

    setPending("magic_link");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: {
          emailRedirectTo: callbackUrl(mode),
          ...(mode === "signup" ? { data: { display_name: displayName.trim() } } : {}),
        },
      });
      if (error) {
        setFormError(friendlyAuthError(error.message));
        return;
      }
      setPhase({ kind: "sent", email: parsed.data.email, reason: "magic_link" });
    } catch (err) {
      setFormError(friendlyAuthError(err instanceof Error ? err.message : ""));
    } finally {
      setPending(null);
    }
  }

  if (phase.kind === "sent") {
    return (
      <div aria-live="polite">
        <div className="eyebrow mb-2">
          {phase.reason === "confirm" ? "One more step" : "Link sent"}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-fog-2">
          {phase.reason === "confirm"
            ? "We sent a confirmation link to "
            : "We sent a sign-in link to "}
          <span className="text-fog">{phase.email}</span>. Open it on this device to finish.
        </p>
        <p className="mt-2 text-[13px] text-fog-3">
          The link expires after an hour. Check spam if it is slow to arrive.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={() => setPhase({ kind: "form" })}>
            Use a different email
          </Button>
          <Link
            href="/city"
            className="inline-flex h-11 items-center px-2 text-[15px] text-fog-2 hover:text-fog"
          >
            Back to the city
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="eyebrow mb-2">{mode === "login" ? "Welcome back" : "New citizen"}</div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fog-2">{copy.lede}</p>

      {formError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[14px] text-danger"
        >
          {formError}
        </p>
      ) : null}

      <form onSubmit={submitPassword} noValidate className="mt-6 flex flex-col gap-4">
        {mode === "signup" ? (
          <Field
            label="Display name"
            name="displayName"
            autoComplete="nickname"
            placeholder="What the city calls you"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={fieldErrors.displayName}
            maxLength={40}
          />
        ) : null}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          autoFocus={mode === "login"}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={mode === "login" ? "Your password" : "At least 8 characters"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint={mode === "signup" ? "At least 8 characters." : undefined}
        />

        <Button
          type="submit"
          size="lg"
          loading={pending === "password"}
          disabled={pending !== null}
          className="mt-1 w-full"
        >
          {pending === "password" ? copy.submitting : copy.submit}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[12px] tracking-wide text-fog-3 uppercase">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="md"
        loading={pending === "magic_link"}
        disabled={pending !== null}
        onClick={sendMagicLink}
        className="w-full"
      >
        {pending === "magic_link" ? "Sending link…" : "Continue with magic link"}
      </Button>
      <p className="mt-2 text-center text-[13px] text-fog-3">
        No password needed. We email you a one-time link.
      </p>

      <p className="mt-6 text-center text-[14px] text-fog-2">
        {copy.switchPrompt}{" "}
        <Link
          href={authPath(mode === "login" ? "signup" : "login", target)}
          className="text-sodium hover:underline"
        >
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  );
}
