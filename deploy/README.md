# Production deployment

One Docker Compose stack runs the new Argus Service Desk on a single Linux host:

| Service | What it is | Exposed |
| --- | --- | --- |
| `web` | Caddy: serves the React app, proxies `/api` to Django, proxies Keycloak, gets HTTPS certificates | 80, 443 |
| `api` | Django + DRF on Gunicorn/Uvicorn | internal |
| `worker`, `beat` | Celery worker and scheduler (security exception expiry, vault rotation, verification, access expiry) | internal |
| `migrate` | One-shot job: Django migrations, legacy Supabase/Drizzle schema, backend SQL; runs before the API starts | — |
| `keycloak` | Sign-in (OIDC), realm `itsm` imported on first start | `127.0.0.1:8081` (admin, via SSH tunnel) |
| `opa` | Authorization policies from `backend/policies` | internal |
| `postgres` | PostgreSQL 16 (app and Keycloak databases) | internal |
| `redis` | Celery broker | internal |

The existing Lovable app is not part of this stack and keeps running where it is.

## 1. Prepare the host

- Linux with Docker Engine 24+ and the Compose plugin. 2 vCPU / 4 GB RAM is enough to start; 4 / 8 for real use.
- Two DNS names pointing at the host, for example `itsm.example.com` (the app) and `sso.example.com` (sign-in).
- Ports 80 and 443 open to the internet. Caddy needs them to get Let's Encrypt certificates.

## 2. Configure

```sh
git clone <this repository> argus && cd argus
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env`. Generate each secret with `openssl rand -base64 32`. The file must stay on the
server; it is git-ignored.

- `APP_DOMAIN`, `AUTH_DOMAIN`, `ACME_EMAIL`.
- Database passwords, `KEYCLOAK_ADMIN_PASSWORD` and `DJANGO_SECRET_KEY`.
- `PAM_MASTER_KEY`. Store a copy somewhere other than the server and its backups (a password manager or
  secrets vault). Without it, nobody can decrypt the vaulted passwords, and a backup that contains it
  exposes them.
- Webhook secrets, SMTP for notification emails, the Anthropic key and S3 evidence storage are optional.

## 3. Start

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps
curl https://<APP_DOMAIN>/health        # {"ok": true}
```

The first start builds both images, creates the databases, applies the full schema and imports the
Keycloak realm. `migrate` should show `exited (0)`; every other service should be running, and `api`
should become healthy.

Save typing with an alias: `alias argus='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'`.

## 4. Sign-in and the first administrator

1. Open the Keycloak admin console through an SSH tunnel. It is not reachable publicly.
   - Run `ssh -L 8081:127.0.0.1:8081 <host>`, then browse to http://localhost:8081/admin.
   - Sign in with `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD`.
   - Create a permanent admin user in the `master` realm and delete the bootstrap one.
2. In the `itsm` realm, add users or connect your directory.
   - For LDAP: *User federation → Add LDAP provider*.
   - Users need a verified email address. That is how they link to their workspace account on first
     sign-in.
3. Give the first person workspace access:

   ```sh
   argus exec api python manage.py grant_workspace_access you@example.com --roles admin,manager
   ```

   Everyone else is invited from **Administration** in the app.
4. Browse to `https://<APP_DOMAIN>` and sign in.

To open the admin console directly from an office network instead of a tunnel, set
`KEYCLOAK_ADMIN_CIDRS` to that network.

## 5. Moving data from the current Supabase project

1. Restore a dump of the Supabase database into `itsm` **before** the first start, or into a fresh
   volume.
2. Run the schema job in record-only mode so it doesn't re-run migrations that are already applied:

   ```sh
   argus run --rm migrate sh -c "python manage.py migrate --noinput && \
     python manage.py apply_legacy_schema --mark-applied && python manage.py apply_app_schema && \
     python manage.py sync_portal_workspace"
   ```

3. Copy the evidence files from the `itsm-evidence` bucket with their names unchanged. Copy them into the
   `evidence` volume, or into S3 when `EVIDENCE_STORAGE=s3`.
4. Point webhook senders at the new host. The paths are unchanged:
   - `https://<APP_DOMAIN>/api/public/alerts` (bearer `MONITORING_WEBHOOK_TOKEN`)
   - `https://<APP_DOMAIN>/api/public/pagerduty` (HMAC `PAGERDUTY_WEBHOOK_SECRET`)
   - `https://<APP_DOMAIN>/api/public/security-findings` (HMAC `SECURITY_SCANNER_SECRET`)

## 6. Privileged access vault

- `PAM_ROTATION_BACKEND=live` changes passwords on the real targets.
  - Put an SSH `known_hosts` file in `deploy/pam/` and set `PAM_SSH_KNOWN_HOSTS=/run/pam/known_hosts`.
    Unknown SSH hosts are refused.
  - Put CA files there too for `PAM_DB_SSL_CA` and `PAM_WINRM_CA`.
- Use `simulated` only for a demo: it changes the vault copy, not the server.
- Test rotation on one non-production secret first.

## 7. Backups

| What | How |
| --- | --- |
| App and Keycloak databases | `argus exec -T postgres sh -c 'pg_dump -U postgres -Fc itsm > /backups/itsm-$(date +%F).dump && pg_dump -U postgres -Fc keycloak > /backups/keycloak-$(date +%F).dump'` (files land in `deploy/backups/`) |
| Evidence files | the `argus_evidence` volume, or your S3 bucket's own backups |
| Vault key | `PAM_MASTER_KEY`, stored separately (see step 2) |
| Configuration | `deploy/.env` |

Run the database dump nightly from cron and copy `deploy/backups/` off the host. Test a restore:
`pg_restore -U postgres -d <empty database> /backups/itsm-<date>.dump`.

## 8. Upgrades

```sh
git pull
argus up -d --build
```

`migrate` applies new schema files before the API restarts. Watch progress with
`argus logs -f migrate api`.

## Troubleshooting

- **Certificates not issued.** Check that both DNS names resolve to this host and that ports 80/443 are
  reachable, then run `argus logs web`.
- **Sign-in loops back to Keycloak.** The API rejects the token, so check `argus logs api`.
  - `KEYCLOAK_ISSUER` must be `https://<AUTH_DOMAIN>/realms/itsm`.
  - The `itsm-web` client must keep the `basic` client scope, which carries the `sub` claim.
- **Changing a domain later.** The realm file is only imported once. After changing `APP_DOMAIN`, update
  *Clients → itsm-web → Valid redirect URIs / Web origins* in Keycloak. After changing `AUTH_DOMAIN`,
  rebuild the `web` image (`argus up -d --build web`).
- **"Authorization is temporarily unavailable" (503).** The API cannot reach OPA. Run `argus ps opa` and
  `argus logs opa`.
