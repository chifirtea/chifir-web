import { notFound, redirect } from "next/navigation";
import { features } from "@/lib/env.server";

/** /admin → the only admin tool so far. Absent (404) when admin is disabled. */
export default function AdminIndex() {
  if (!features.admin) notFound();
  redirect("/admin/generate");
}
