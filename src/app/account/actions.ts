"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UpdateProfileState } from "@/features/account/DisplayNameForm";

const displayNameSchema = z.object({
  displayName: z
    .string({ error: "Enter a display name." })
    .trim()
    .min(2, "Use at least 2 characters.")
    .max(40, "Use at most 40 characters."),
});

export async function updateDisplayName(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Sign in to change your name." };

  const parsed = displayNameSchema.safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "Enter a display name." };
  }
  const { displayName } = parsed.data;

  try {
    const profile = await getDataSource().updateProfile(user.id, { displayName });

    // Keep the auth metadata in step so `getCurrentUser().displayName` and the HUD agree. Best effort.
    const supabase = await getServerSupabase();
    if (supabase) {
      const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (error)
        console.warn("[account] could not sync display_name to auth metadata:", error.message);
    }

    revalidatePath("/account");
    return { status: "saved", displayName: profile.displayName };
  } catch (error) {
    console.error("[account] updateDisplayName failed", error);
    return { status: "error", error: "Could not save your name. Try again." };
  }
}
