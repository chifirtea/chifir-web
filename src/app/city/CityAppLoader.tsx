"use client";

import dynamic from "next/dynamic";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import type { CityAppProps } from "./CityApp";

/**
 * The 3D bundle is client-only and lazy: `ssr: false` must be requested from a client component
 * in Next 16, so this thin wrapper exists purely to host the dynamic import.
 */
const CityApp = dynamic(() => import("./CityApp").then((m) => m.CityApp), {
  ssr: false,
  loading: () => <LoadingScreen />,
});

export function CityAppLoader(props: CityAppProps) {
  return <CityApp {...props} />;
}
