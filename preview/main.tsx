import "@/app/globals.css";
import { createRoot } from "react-dom/client";
import { CityApp } from "@/app/city/CityApp";
import type { CitySnapshot } from "@/lib/data/types";
import snapshotJson from "./snapshot.json";

/**
 * Static preview entry. There is no server behind this page, so the API routes answer locally
 * with the same responses the real app gives when a service is not configured.
 */
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/api/analytics")) return Promise.resolve(new Response(null, { status: 204 }));
  if (url.startsWith("/api/ai/")) {
    return Promise.resolve(
      new Response(JSON.stringify({ type: "error", code: "unavailable", message: "The concierge is off duty in this preview." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  if (url.startsWith("/api/checkout")) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "Checkout is not configured" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return realFetch(input, init);
};

const snapshot = snapshotJson as unknown as CitySnapshot;
createRoot(document.getElementById("root")!).render(<CityApp snapshot={snapshot} />);
