# WeCrew production VM deployment

This deployment runs the TanStack/Nitro application as a Node server on the existing
`wecrew-prod` k3s VM. Supabase database, authentication, Storage and RLS remain on the
current managed project. It is application self-hosting, not a Supabase data migration.

The isolated namespace is `wecrew-servicedesk`, with `desk.wecrew.in` as the
hostname. The existing LinkedEye deployments and `itsm.wecrew.in` are separate systems.
The Lovable-connected branch can continue publishing independently.

## Build

From the repository root:

```sh
bun scripts/build-self-host.mjs harbor.wecrew.in/linkedeye/wecrew-servicedesk:<tag>
docker push harbor.wecrew.in/linkedeye/wecrew-servicedesk:<tag>
```

The builder receives only the public Supabase URL and publishable key. All `.env`
files, local artifacts and editor worktrees are excluded from Docker context. The
runtime image contains only `.output`, runs as UID 1000 and uses a read-only root
filesystem. Nitro's `NITRO_PRESET=node-server` is set only inside the image build;
the existing Lovable build configuration is unchanged.

If dependency fetching inside Docker is unavailable, use the checked-in runtime
packaging path. First install exactly the lockfile and build the Node output locally:

```sh
bun install --frozen-lockfile
NITRO_PRESET=node-server bun run build
docker buildx build --platform linux/amd64 --load -f Dockerfile.runtime \
  -t harbor.wecrew.in/linkedeye/wecrew-servicedesk:<tag> .
```

Before packaging an output built on another architecture, verify `.output` contains
no native `.node`, `.so` or `.dylib` files, then test the resulting Linux image. The
runtime Dockerfile has a dedicated ignore file that includes only `.output`.

## Runtime configuration

Create `itsm-public` in the target namespace with `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`, matching the values used for the browser build.
Use an existing project-scoped registry pull credential for Secret `harbor-pull`.
Do not put push credentials or a Supabase service-role key into the app container.
Core user and administrator operations run with the caller's authenticated Supabase
client and existing database controls.

For this existing cluster, `bun scripts/configure-wecrew-prod.mjs` creates the
namespace and public ConfigMap and copies the existing LinkedEye project pull
credential from `linkedeye-build`. It never prints credential values or overwrites
the optional AI Secret. Review the context and namespace constants before use.

The optional `itsm-ai` Secret may contain `LOVABLE_API_KEY`. Without that key the
AI assistant reports that it is not configured; the core service desk still runs.
Provision the key through the deployment secret manager, never Git or build arguments.

Email sign-in uses the existing Supabase accounts. Configure the new site origin in
the provider's redirect allowlist before relying on password-reset, email-confirmation
or OAuth links. A successful public page does not prove these authentication flows.

## Apply and verify

Update the Deployment image to the pushed digest before rollout. Pin every command
to the intended context:

```sh
kubectl --context wecrew-prod get --raw=/readyz
kubectl --context wecrew-prod diff -k k8s/wecrew-prod
kubectl --context wecrew-prod apply -k k8s/wecrew-prod
kubectl --context wecrew-prod -n wecrew-servicedesk rollout status deployment/web --timeout=300s
kubectl --context wecrew-prod -n wecrew-servicedesk get pods,service,ingress,certificate
```

The VM had only 20m of unallocated CPU requests at preflight. This small application
requests 10m CPU and 128Mi memory, with burst limits of 500m/512Mi. One replica with
`maxSurge: 0` means future upgrades have a short availability gap. Monitor actual
usage and add capacity before requiring multiple replicas or stronger reservations.
HTTP probes confirm the app server renders; separately verify Supabase connectivity
and signed-in workflows.

DNS requires a dedicated A record pointing to the production ingress address
`187.127.118.240`. Use the existing `letsencrypt-prod-dns01` issuer for TLS. Validate
the certificate, direct ingress routing and authoritative DNS separately. Do not
change the wildcard record or another application's host.

## Database and rollback

This release uses the already-applied managed database migrations through `0009`.
Do not replay migrations or seed fixtures during app startup. Subsequent releases
must migrate the shared database once, before deploying a compatible app image.

Roll back a later app revision with a previously published image digest (or
`kubectl --context wecrew-prod -n wecrew-servicedesk rollout undo deployment/web`).
Keep additive database migrations in place and review compatibility. A rollback
must not change existing memberships or bypass authorization/audit controls.
