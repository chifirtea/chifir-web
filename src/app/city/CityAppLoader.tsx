"use client";

import dynamic from "next/dynamic";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { mark } from "@/lib/perf/marks";
import type { CityAppProps } from "./CityApp";

// The page's own JS has arrived (the snapshot came with the HTML, so it is ready at the same time).
mark("city:page-js");
mark("city:snapshot-ready");

/**
 * The 3D bundle is client-only and lazy: `ssr: false` must be requested from a client component
 * in Next 16, so this thin wrapper exists purely to host the dynamic import. The marks around
 * the import measure the 3D chunk's download + evaluation (docs/PERFORMANCE.md).
 */
const CityApp = dynamic(
  () => {
    mark("city:3d-chunk-start");
    return import("./CityApp").then((m) => {
      mark("city:3d-chunk-loaded");
      return m.CityApp;
    });
  },
  {
    ssr: false,
    loading: () => <LoadingScreen />,
  },
);

export function CityAppLoader(props: CityAppProps) {
  return <CityApp {...props} />;
}
