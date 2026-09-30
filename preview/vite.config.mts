import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = fileURLToPath(new URL("../src", import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  publicDir: false,
  resolve: {
    alias: {
      "@": src,
      "next/link": fileURLToPath(new URL("./shims/next-link.tsx", import.meta.url)),
      "next/navigation": fileURLToPath(new URL("./shims/next-navigation.ts", import.meta.url)),
      "server-only": fileURLToPath(new URL("./shims/empty.ts", import.meta.url)),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.NEXT_PUBLIC_APP_URL": "undefined",
    "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined",
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": "undefined",
    "process.env": "{}",
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: fileURLToPath(new URL("..", import.meta.url)) },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
  },
});
