import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Exact module specifiers (a bare directory pattern would also match `@/lib/data/types`,
// which is type-only and client-safe).
const SERVER_ONLY_MODULES_REGEX =
  "^(@/lib/supabase/admin|@/lib/supabase/server|@/lib/stripe(/.*)?|@/lib/ai/(anthropic|concierge|employee|tools|prompts)|@/lib/env\\.server|@/lib/data|@/lib/data/(index|static|supabase|search)|@/lib/auth/session|@/data/seed(/.*)?)$";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "node_modules/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "preview/dist/**",
  ]),
  {
    rules: {
      // Merchant images are arbitrary external URLs rendered with a fallback; the Next image
      // optimizer would require a domain allowlist per merchant.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // React Three Fiber elements use three.js props (position, args, intensity, ...), and frame
    // loops mutate three.js objects (materials, uniforms, scene fog) by design. The compiler's
    // immutability rule cannot tell those from React state, so it is off for engine code only.
    files: ["src/engine/**/*.{ts,tsx}", "src/city/**/*.{ts,tsx}"],
    rules: { "react/no-unknown-property": "off", "react-hooks/immutability": "off" },
  },
  {
    // Keep the /city bundle small: no namespace imports of drei/three (they defeat tree-shaking).
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportNamespaceSpecifier[parent.source.value='@react-three/drei']",
          message: "Import named members from @react-three/drei; namespace imports pull in the whole library.",
        },
      ],
    },
  },
  {
    // Client-side code may never import server-only modules.
    files: ["src/engine/**", "src/features/**", "src/components/**", "src/city/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: SERVER_ONLY_MODULES_REGEX,
              message: "Server-only module. Use it from a route handler or server component.",
            },
          ],
        },
      ],
    },
  },
]);
