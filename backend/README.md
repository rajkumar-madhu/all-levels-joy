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
| `PATCH /api/v1/orgs/{org}/incidents/{id}` | `incident.update` (service desk, fulfiller, manager, admin) | assign, group, impact/urgency, hold, resolve, close, reopen; rules ported from `incident-workflow.ts`, re-checked by `validate_incident_workflow`; 409 when `expectedUpdatedAt` is stale |
| `GET, POST /api/v1/orgs/{org}/incidents/{id}/comments` | `comment.read` / `comment.create` | RLS on `record_comments` hides internal notes from requesters; each comment writes a `comment_added` audit event |
| `GET, POST /api/v1/orgs/{org}/requests/{id}/comments` | same | same |
| `GET /api/v1/orgs/{org}/groups` | `group.read` | active assignment groups |
| `GET /api/v1/orgs/{org}/knowledge?q=` | `knowledge.read` | RLS on `knowledge_articles` |
| `GET /api/v1/orgs/{org}/knowledge/{id}` | `knowledge.read` | RLS |
| `POST /api/v1/orgs/{org}/knowledge` | `knowledge.author` (service desk, fulfiller, manager, admin) | new article (draft, review, published or retired); tags normalised as in the legacy app |
| `PATCH /api/v1/orgs/{org}/knowledge/{id}` | `knowledge.author` | edit and move between statuses; needs `expectedUpdatedAt` (409 when stale); saving a published article bumps its version |
| `GET, POST /api/v1/orgs/{org}/knowledge/categories` | `knowledge.read` / `knowledge.author` | categories with article counts |
| `PATCH /api/v1/orgs/{org}/knowledge/categories/{id}` | `knowledge.author` | rename (moves its articles in the same transaction) or deactivate |
| `GET, POST /api/v1/orgs/{org}/problems?state=&knownError=` | `problem.read` (staff) / `problem.run` (service desk, fulfiller, manager, admin, change manager) | list with incident counts; create, optionally from an incident (linked in the same transaction) |
| `GET, PATCH /api/v1/orgs/{org}/problems/{id}` | `problem.read` / `problem.run` | detail with linked incidents; state, known error, workaround, root cause, fix plan, resolution, impact/urgency, known-error article; versioned by `expectedUpdatedAt` |
| `POST /api/v1/orgs/{org}/problems/{id}/incidents` | `problem.run` | link or unlink an incident (keeps `incidents.problem_id` and `problem_incidents` in step) |
| `GET /api/v1/orgs/{org}/security/board` | `security.board.read` | `can_manage` + RLS |
| `POST /api/v1/orgs/{org}/security/findings` | `security.finding.create` | `itsm_create_security_finding` |
| `POST /api/v1/orgs/{org}/security/findings/{id}/transition` | `security.finding.transition` | `itsm_transition_security_finding` |
| `POST /api/v1/orgs/{org}/security/findings/{id}/exceptions` | `security.exception.request` | `itsm_request_security_exception` |
| `POST /api/v1/orgs/{org}/security/exceptions/{id}/decision` | `security.exception.decide` | `itsm_decide_security_exception` |
| `GET /api/v1/orgs/{org}/catalog` | `catalog.read` | active `catalog_items` |
| `GET /api/v1/orgs/{org}/requests?state=&q=` | `request.list` | RLS on `service_requests` |
| `POST /api/v1/orgs/{org}/requests` | `request.create` | `itsm_create_service_request` |
| `GET /api/v1/orgs/{org}/requests/{id}` | `request.read` | RLS, with its approvals |
| `PATCH /api/v1/orgs/{org}/requests/{id}` | `request.update` (service desk, fulfiller, manager, admin) | update guarded by `expectedUpdatedAt` (409 when stale) and the table's approval triggers |
| `GET /api/v1/orgs/{org}/changes?state=&q=` | `change.list` | RLS on `changes` |
| `POST /api/v1/orgs/{org}/changes` | `change.create` (fulfiller, change manager, manager, admin) | `itsm_create_change` |
| `GET /api/v1/orgs/{org}/changes/{id}` | `change.read` | RLS, with its CAB approvals |
| `POST /api/v1/orgs/{org}/changes/{id}/actions` | `change.update` (change manager, admin) | start / deliver / close / cancel, with the same gates as the legacy `updateChange` |
| `GET /api/v1/orgs/{org}/approvals?status=` | `approval.list` | approvals assigned to the caller |
| `POST /api/v1/orgs/{org}/approvals/{id}/decision` | `approval.decide` | `itsm_decide_approval` |
| `GET /api/v1/orgs/{org}/command-center` | `major_incident.read` (staff) | bridges, timeline, active incidents to declare from, problems |
| `POST /api/v1/orgs/{org}/major-incidents` | `major_incident.run` (service desk, fulfiller, manager, admin, change manager) | declare: bridge, declaration update, incident flag and audit in one transaction; 409 and full rollback if the incident changed meanwhile |
| `PATCH /api/v1/orgs/{org}/major-incidents/{id}` | `major_incident.run` | bridge state, take command/comms, escalate, link a problem (also links the incident) |
| `POST /api/v1/orgs/{org}/major-incidents/{id}/updates` | `major_incident.run` | stakeholder update with audience and next-update cadence |
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
workspaces, the security lifecycle through the database functions, request approval and fulfilment, the
change lifecycle through CAB approval, incident handling (hold, resolve, reopen, stale edits), internal
notes hidden from requesters, and all three webhooks. `tests/test_incident_workflow.py` mirrors the legacy
`tests/incident-workflow.test.ts` rules.

### Differences from the legacy command center

- Bridge links must be http(s). The legacy app accepted any text and rendered it as a link.
- Declaring is atomic. The legacy server function could create the bridge and then fail to flag the incident.
- Declaration notifications are not sent. The legacy code inserted them as the signed-in user, but
  `notifications` has no insert policy, so those inserts were always refused (and the error ignored).
  Sending them needs a security-definer function or a Celery task with the service role.

### Known limitation in the existing schema

Record numbers (`INC0001001`, `REQ…`, `CHG…`) are unique across the whole database, but the counters that
issue them are per workspace. The current app runs a single workspace, so this never shows. A second
workspace would collide on its first record until the counters are made global or the uniqueness becomes
per workspace. That needs a schema migration agreed with the Lovable app, so it is not changed here. Policy tests
needing OPA are skipped when no `opa` binary is found.

## Not migrated yet

Staff-raised incidents (with group and service), request tasks, CMDB, catalogue
administration, workspace administration, comments, attachments (Supabase Storage → object storage) and the
AI assistant still run only in the current app. Each one should
follow the same pattern: an OPA action, a `CallerAPIView`, and calls to the existing SQL functions.
