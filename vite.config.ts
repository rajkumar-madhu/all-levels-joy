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
  vite: {
    server: {
      // Browser sessions use the same public origin as the dev server. These
      // prefixes belong to the local Supabase API, not to app routes.
      proxy: {
        "/auth/v1": { target: "http://127.0.0.1:54321", changeOrigin: true },
        "/rest/v1": { target: "http://127.0.0.1:54321", changeOrigin: true },
        "/storage/v1": { target: "http://127.0.0.1:54321", changeOrigin: true },
        "/realtime/v1": { target: "http://127.0.0.1:54321", changeOrigin: true, ws: true },
      },
    },
  },
});
