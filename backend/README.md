# ITSM API (Django)

Django + Django REST Framework backend for the replatformed ITSM workspace. It runs beside the current
Lovable/TanStack Start app and uses the **same PostgreSQL schema**, so modules can move over one at a time.

| Concern | Choice |
|---|---|
| API | Django 5.2, DRF 3.16, served by Gunicorn with Uvicorn (ASGI) workers |
| Identity | Keycloak (OIDC). The SPA uses authorization code + PKCE; the API validates bearer access tokens against the realm JWKS |
| Authorization | OPA sidecar (`policies/itsm`), then PostgreSQL row-level security and the legacy security-definer functions |
| Data | PostgreSQL 16, the existing Supabase + Drizzle schema, applied unchanged |
| Background work | Celery with Redis 7 (beat replaces the external cron) |

## How a request is authorized

1. `KeycloakJWTAuthentication` verifies the token (issuer, audience `itsm-api`, expiry, signature).
2. `apps/core/identity.py` maps the Keycloak `iss` + `sub` to the legacy user id through `app.external_identities`.
   On first sign-in it links to the existing `auth.users` row with the same **verified** email, so existing
   tickets, approvals and audit history keep their owner. Unverified emails are refused.
3. `PolicyPermission` asks OPA `itsm/authz/allow` with the caller's roles per workspace. If OPA can't be
   reached, the request is refused with 503.
4. `CallerAPIView.initial` runs `SET LOCAL ROLE authenticated` and sets `request.jwt.claim.sub`, which the
   legacy `auth.uid()` reads. From then on RLS and the `itsm_*` functions see the real caller. Every request
   is one transaction (`ATOMIC_REQUESTS`), so nothing leaks between pooled connections.

Webhooks and Celery jobs use `act_as_service()` (`service_role`, bypasses RLS) and are authenticated with
their own shared secrets.

### Rules kept from AGENTS.md

- Security findings change only through `itsm_*security*` functions. The `authenticated` role has SELECT
  only; `tests/test_security.py::test_staff_cannot_write_findings_table_directly` proves it.
- Security board reads run `can_manage` in the database before any finding or linked record is read, even
  when OPA allowed the request.
- Window and exception timestamps must carry an offset (`OffsetDateTimeField`). The browser converts local
  time with the shared `security-window` helper.
- Scanner intake (`/api/public/security-findings`, `x-argus-signature` HMAC with `SECURITY_SCANNER_SECRET`)
  calls `itsm_upsert_scanner_finding`, which dedupes on scanner + reference + asset.
- Monitoring alerts (`/api/public/alerts`, bearer `MONITORING_WEBHOOK_TOKEN`) become `contact_type=monitoring`
  incidents deduplicated by the unchanged `[alert:source:fingerprint]` marker.
- PagerDuty (`/api/public/pagerduty`, `X-PagerDuty-Signature` HMAC with `PAGERDUTY_WEBHOOK_SECRET`) saves
  through `itsm_upsert_pagerduty_incident`.

## API

Request bodies use the same camelCase fields as the legacy server functions; responses return database rows
(snake_case).

| Method & path | Policy action | Backed by |
|---|---|---|
| `GET /api/v1/me` | signed in | identity + memberships |
| `POST /api/v1/me/bootstrap` | signed in | `bootstrap_workspace` |
| `GET /api/v1/orgs/{org}/incidents?state=&q=&limit=` | `incident.list` | RLS on `incidents` |
| `POST /api/v1/orgs/{org}/incidents` | `incident.create_self_service` | `itsm_self_service_incident` |
| `GET /api/v1/orgs/{org}/incidents/{id}` | `incident.read` | RLS |
| `GET /api/v1/orgs/{org}/knowledge?q=` | `knowledge.read` | RLS on `knowledge_articles` |
| `GET /api/v1/orgs/{org}/knowledge/{id}` | `knowledge.read` | RLS |
| `GET /api/v1/orgs/{org}/security/board` | `security.board.read` | `can_manage` + RLS |
| `POST /api/v1/orgs/{org}/security/findings` | `security.finding.create` | `itsm_create_security_finding` |
| `POST /api/v1/orgs/{org}/security/findings/{id}/transition` | `security.finding.transition` | `itsm_transition_security_finding` |
| `POST /api/v1/orgs/{org}/security/findings/{id}/exceptions` | `security.exception.request` | `itsm_request_security_exception` |
| `POST /api/v1/orgs/{org}/security/exceptions/{id}/decision` | `security.exception.decide` | `itsm_decide_security_exception` |
| `POST /api/public/alerts` | bearer token | port of `monitoring-alerts.ts` |
| `GET, POST /api/public/pagerduty` | HMAC | `itsm_upsert_pagerduty_incident` |
| `POST /api/public/security-findings` | HMAC | `itsm_upsert_scanner_finding` |
| `GET /health` | none | database ping |

Database business-rule errors (`RAISE EXCEPTION`) come back as `400 {"detail": "..."}`, and permission
errors (`42501`) as `403`.

## Run locally

```sh
cd backend
docker compose up --build          # Postgres 16, Redis 7, Keycloak, OPA, API, Celery worker and beat
docker compose exec api python manage.py grant_workspace_access admin@wecrew.in --roles admin,manager
```

Keycloak runs at http://localhost:8080 (console admin/admin). The `itsm` realm is imported from
`keycloak/realm-itsm.json` with a dev user `admin@wecrew.in` / `dev-admin-password`, which must be changed on
first sign-in. To add LDAP, go to *User federation → Add LDAP provider* in the realm. Users keep the email
attribute, which is how they link to existing accounts.

Without Docker:

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # then export the variables
python manage.py migrate            # creates the platform roles/schemas the legacy SQL expects
python manage.py apply_legacy_schema  # supabase/migrations, then drizzle/migrations in journal order
gunicorn config.asgi:application -k uvicorn_worker.UvicornWorker -b 0.0.0.0:8000
celery -A config worker -l info & celery -A config beat -l info
```

For a database restored from the Supabase project, run `python manage.py apply_legacy_schema --mark-applied`
once instead. It records the chain without executing it.

## Tests

```sh
POSTGRES_USER=postgres POSTGRES_PASSWORD=... POSTGRES_HOST=localhost DJANGO_DEBUG=1 OPA_BIN=$(which opa) pytest
opa test policies/
ruff check . && ruff format --check .
```

The pytest suite builds a fresh PostgreSQL 16 database with the full legacy schema and starts a real OPA
server. It covers identity linking, token checks, OPA fail-closed, RLS isolation between requesters and
workspaces, the security lifecycle through the database functions, and all three webhooks. Policy tests
needing OPA are skipped when no `opa` binary is found.

## Not migrated yet

Requests, changes, approvals, problems, major incidents, CMDB, catalogue, administration, attachments
(Supabase Storage → object storage) and the AI assistant still run only in the current app. Each one should
follow the same pattern: an OPA action, a `CallerAPIView`, and calls to the existing SQL functions.
