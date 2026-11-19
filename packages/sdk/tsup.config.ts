import { defineConfig } from "tsup";

// Two builds so the React entry can carry a "use client" directive without marking the core client as client-only.
// The React entry imports the core through the package name, which stays external, so error classes keep one identity.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    treeshake: true,
  },
  {
    entry: { "react/index": "src/react/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2022",
    external: ["@showmark/sdk", "react", "react/jsx-runtime", "qrcode", "viem"],
    banner: { js: '"use client";' },
  },
]);
