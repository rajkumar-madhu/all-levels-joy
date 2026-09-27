// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Self-hosted (wecrew-k8s) target: plain Node server instead of the Cloudflare Worker
  // default. Lovable's own cloud build/preview forces `cloudflare-module` regardless of
  // this setting (see isSandboxEnvironment() in @lovable.dev/vite-tanstack-config), so this
  // only takes effect for builds run outside Lovable's sandbox, e.g. the Docker image below.
  nitro: {
    preset: "node-server",
  },
});
