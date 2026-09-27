import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
export default defineConfig({
  cacheDir: "node_modules/.vite-itsm-ui",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@/lib/itsm.functions", replacement: path("./no-network.ts") },
      { find: "@/lib/problem.functions", replacement: path("./no-network.ts") },
      { find: "@/integrations/supabase/client", replacement: path("./no-network.ts") },
      { find: "@", replacement: path("../../src") },
    ],
  },
  server: { host: "127.0.0.1", port: 8081, strictPort: true },
});
