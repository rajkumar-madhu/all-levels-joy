# React app built once, then served by Caddy, which also terminates TLS and proxies the API and Keycloak.
FROM node:22-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID=itsm-web
# Empty: the API is same-origin (/api) behind Caddy.
ENV VITE_API_BASE= VITE_OIDC_AUTHORITY=${VITE_OIDC_AUTHORITY} VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID}
RUN test -n "$VITE_OIDC_AUTHORITY" && npm run build

FROM caddy:2.10-alpine
COPY --from=build /src/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
