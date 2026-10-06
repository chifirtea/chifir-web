"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export type UpdateProfileState =
  | { status: "idle" }
  | { status: "saved"; displayName: string }
  | { status: "error"; error: string };

export type UpdateProfileAction = (
  state: UpdateProfileState,
  formData: FormData,
) => Promise<UpdateProfileState>;

/** Inline display-name editor. The server action is passed in by the page (no app→feature import). */
export function DisplayNameForm({
  action,
  initialName,
}: {
  action: UpdateProfileAction;
  initialName: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const current = state.status === "saved" ? state.displayName : initialName;
  const error = state.status === "error" ? state.error : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="displayName" className="eyebrow">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            key={current}
            defaultValue={current}
            required
            minLength={2}
            maxLength={40}
            autoComplete="nickname"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "displayName-error" : undefined}
            className={cn(
              "h-11 w-full rounded-xl border bg-night/60 px-3.5 text-[15px] text-fog placeholder:text-fog-3 focus:outline-none",
              error ? "border-danger/60 focus:border-danger" : "border-line focus:border-sodium/60",
            )}
          />
        </div>
        <Button type="submit" variant="secondary" loading={pending} className="sm:w-auto">
          {pending ? "Saving…" : state.status === "saved" ? "Saved" : "Save name"}
        </Button>
      </div>
      {error ? (
        <p id="displayName-error" role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : state.status === "saved" ? (
        <p role="status" className="text-[13px] text-mint">
          Your name is updated.
        </p>
      ) : (
        <p className="text-[13px] text-fog-3">
          What other people in the city see. 2 to 40 characters.
        </p>
      )}
    </form>
  );
}
