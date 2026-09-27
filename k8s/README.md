# Self-hosting on wecrew-k8s

This app is normally built by Lovable for Cloudflare Workers (see `vite.config.ts`).
`nitro.preset: "node-server"` in that same file only takes effect for builds run outside
Lovable's own cloud sandbox — e.g. this Docker image — so it doesn't affect Lovable's sync/
preview pipeline.

None of this has been applied to the cluster yet; these are files to review and run yourself.

## 1. Build and push the image

```sh
docker build -t <HARBOR_REGISTRY>/wecrew/all-levels-joy:<tag> .
docker push <HARBOR_REGISTRY>/wecrew/all-levels-joy:<tag>
```

Replace `<HARBOR_REGISTRY>` with your Harbor host and `image:` in `deployment.yaml` with the
pushed reference. This wasn't test-built in this session (no Docker daemon available) — the
underlying `bun install` → `bun run build` → `node .output/server/index.mjs` steps were
verified directly and work, but do a local `docker build` before pushing.

## 2. Point kubectl at the cluster

```sh
~/bin/wecrew-k8s-tunnel   # or: ssh -f -N -L 34995:127.0.0.1:34995 wecrew-anypoint
kubectl config use-context kind-wecrew
```

## 3. Create the namespace and secret

```sh
kubectl apply -f k8s/namespace.yaml
kubectl -n itsm create secret generic itsm-supabase \
  --from-literal=SUPABASE_URL=... \
  --from-literal=SUPABASE_PUBLISHABLE_KEY=... \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=... \
  --from-literal=LOVABLE_API_KEY=...
```

See `secret.example.yaml` for where each value comes from. Do not commit a filled-in secret
manifest.

## 4. Apply the app

```sh
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/ingress.yaml
kubectl -n itsm rollout status deployment/itsm
```

## 5. Expose it through Traefik (manual — not done by this change)

The cluster's edge Traefik does host-network TLS passthrough into kind on `:8443`, routed by
`HostSNI` in `/docker/traefik/dynamic/cluster.yml` on `wecrew-anypoint`. Adding
`itsm.wecrew.in` there means SSHing into the host and editing that live shared config — that
step was deliberately left out of this change. Add the new `HostSNI` entry there yourself,
following the existing `research.wecrew.in` entry as a template, then reload Traefik's config.

## Env vars at a glance

| Var | Where it's used | Secret? |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Inlined into the client bundle at build time (`.env` in this repo) **and** read from `process.env` at runtime by `auth-middleware.ts` | No — already public in this repo |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/integrations/supabase/client.server.ts`, bypasses RLS | Yes |
| `LOVABLE_API_KEY` | `src/lib/assistant.functions.ts`, calls Lovable's AI Gateway. Without it the AI assistant page returns an error but the rest of the app works | Yes |
