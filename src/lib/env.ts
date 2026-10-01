import { z } from "zod";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.preprocess(blankToUndefined, z.url().default("http://localhost:3000")),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
});

/**
 * Public env is safe in the browser. Each key is referenced explicitly so Next.js can inline it.
 */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const hasSupabaseAuth = Boolean(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
