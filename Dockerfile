# Build the same application as Lovable, with Nitro's Node target for Kubernetes.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG SUPABASE_URL
ARG SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=${SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY} \
    NITRO_PRESET=node-server
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" && bun run build

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
