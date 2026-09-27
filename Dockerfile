# Self-hosted (wecrew-k8s) build. Lovable's own preview/build still targets Cloudflare
# Workers via nitro's cloudflare-module preset; this image builds the node-server preset
# instead (see vite.config.ts) and runs it as a plain Node process.
FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Includes the committed .env, which holds only the public Supabase URL/publishable key —
# Vite inlines VITE_-prefixed values into the client bundle at build time (loadEnv("VITE_")
# in @lovable.dev/vite-tanstack-config), so they must be present here, not just at runtime.
COPY . .
RUN bun run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Only the build output ships — no source, no devDependencies, no .env. Runtime secrets
# (SUPABASE_SERVICE_ROLE_KEY, LOVABLE_API_KEY) come from the k8s Secret, never from this image.
COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
