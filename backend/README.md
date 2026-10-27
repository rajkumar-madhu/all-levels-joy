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
| `GET /api/v1/orgs/{org}/incidents?queue=&q=&priority=&group=&service=&sort=&page=` | `incident.list` | work queues from `incident-queue.ts` (active, mine, unassigned, at_risk, breached, completed, all); 25 per page with `total` |
| `GET /api/v1/orgs/{org}/incidents/queue-counts` | `incident.list` | totals per queue; filters never change them |
| `POST /api/v1/orgs/{org}/incidents/operator` | `incident.create` (staff) | legacy `createIncident`: routed to a group and service, phone/email/walk-up contact |
| `GET /api/v1/orgs/{org}/incidents/{id}/links` | `change.link.read` | changes linked to the incident and its problem |
| `GET /api/v1/orgs/{org}/services` | `service.read` | business services |
| `GET, POST /api/v1/orgs/{org}/assets?q=&status=` | `asset.read` (staff) / `asset.manage` (CMDB owner, admin) | configuration items; create writes an `asset` audit event |
| `GET, PATCH /api/v1/orgs/{org}/assets/{id}` | same | item with relationships; PATCH guarded by `expectedUpdatedAt` (409) |
| `POST /api/v1/orgs/{org}/assets/{id}/relationships`, `DELETE …/relationships/{rid}` | `asset.manage` | `ci_relationships` |
| `GET /api/v1/orgs/{org}/catalog/admin`, `PATCH /api/v1/orgs/{org}/catalog/{id}` | `catalog.manage` (manager, admin) | routing group, priority, approval, retire/restore; versioned |
| `GET, POST /api/v1/orgs/{org}/requests/{id}/tasks`, `PATCH …/tasks/{tid}` | `request.task.read` / `request.task.manage` (staff) | fulfilment tasks, only after approval; versioned state changes |
| `GET, POST /api/v1/orgs/{org}/changes/{id}/links`, `DELETE …/links/{lid}` | `change.link.read` (members) / `change.link.manage` (staff) | incidents and problems a change resolves, plus its affected CIs |
| `GET /api/v1/orgs/{org}/change-link-candidates` | `change.link.manage` | recent incidents and problems to link |
| `GET, POST /api/v1/orgs/{org}/assistant/threads` | `assistant.use` (member) | the caller's own conversations (RLS on `ai_chat_threads`) |
| `GET, DELETE /api/v1/orgs/{org}/assistant/threads/{id}` | `assistant.use` | conversation with its messages; other users get 404 |
| `POST /api/v1/orgs/{org}/assistant/threads/{id}/messages` | `assistant.use` | **server-sent events**: `delta` {text} … `done` {message} or `error`; answers grounded in knowledge the caller can read |
| `POST /api/v1/orgs/{org}/assistant/messages/{id}/ticket` | `assistant.use` | raises the proposed ticket via `itsm_self_service_incident` (contact type `chat`) |
| `GET /api/v1/portal` | `portal.use` (confirmed `@PORTAL_EMAIL_DOMAIN` account) | the caller's incidents and requests, public comments, known-error workarounds, customer outage updates |
| `POST /api/v1/portal/tickets` | `portal.use` | `portal_submit_ticket` |
| `POST /api/v1/portal/{incidents,requests}/{id}/replies` | `portal.use` | `portal_reply` / `portal_reply_request` (can resume or reopen) |
| `GET /api/public/knowledge?query=&category=`, `GET /api/public/knowledge/{id}` | none (anonymous) | runs as `anon`: published articles and active categories only |
| `GET /api/v1/orgs/{org}/integrations/status?force=1` | `integrations.read` (admin) | which channels are configured (booleans only), intake URLs, scheduled jobs, tool reachability |
| `POST /api/public/alerts` | bearer token | port of `monitoring-alerts.ts` |
| `GET, POST /api/public/pagerduty` | HMAC | `itsm_upsert_pagerduty_incident` |
| `POST /api/public/security-findings` | HMAC | `itsm_upsert_scanner_finding` |
| `GET /api/v1/orgs/{org}/sla` | `sla.read` | open requests and incidents per team (RLS-scoped), due within 24h and breached |
| `GET /api/v1/orgs/{org}/insights/incidents` | `insights.read` | port of `getIncidentMetrics` (30-day volumes, MTTR, response, SLA attainment, backlog) |
| `GET /api/v1/orgs/{org}/{incidents\|requests}/{id}/activity` | `activity.read` | timeline from paginated `source = 'database'` audit snapshots plus SLA targets (`apps/insights/timeline.py`, port of `ticket-timeline.ts`) |
| `GET /api/v1/orgs/{org}/search?q=` | `search.read` | port of `searchRecords`; each section RLS-scoped |
| `GET, POST /api/v1/orgs/{org}/{incidents\|requests\|changes}/{id}/attachments` | `attachment.read` / `attachment.create` | multipart upload; `storage.objects` and `attachments` rows written as the caller under RLS, then the file is stored |
| `GET /api/v1/orgs/{org}/attachments/{id}/download` | `attachment.read` | re-checks `can_access_evidence_path`; always served as a download with `nosniff` and a sandbox CSP |
| `GET /health` | none | database ping |

Database business-rule errors (`RAISE EXCEPTION`) come back as `400 {"detail": "..."}`, and permission
errors (`42501`) as `403`.

### Evidence attachments

Files replace the legacy Supabase Storage bucket `itsm-evidence` and keep its object names
(`{org}/{record_type}/{record_id}/{file}`), so `can_access_evidence_path` still governs them. There are no public
or pre-signed links: the API checks access and streams the file.

- Development: local disk under `EVIDENCE_ROOT` (default `backend/var/evidence`, git-ignored).
- Production: `EVIDENCE_STORAGE=s3` with `EVIDENCE_S3_BUCKET`, `EVIDENCE_S3_ENDPOINT_URL` (for MinIO or another
  S3-compatible store), `EVIDENCE_S3_REGION`, `EVIDENCE_S3_ACCESS_KEY_ID` and `EVIDENCE_S3_SECRET_ACCESS_KEY`. Keep
  the bucket private.
- Uploads are limited to 25 MB (`ATTACHMENT_MAX_BYTES`), as in the legacy app. File names are reduced to a safe
  basename and prefixed with a random id, so names can never escape the record's folder.
- Migrating existing files: copy the `itsm-evidence` objects with their names unchanged; the `attachments` rows already
  point at them. If a database commit fails after a file was written, that file is left unreferenced; a periodic
  sweep of objects without an `attachments` row can remove them.

## Privileged access (PAM)

A vault for privileged account passwords, with time-boxed access, rotation and verification. It is new in
this backend (the legacy app has no equivalent), so its schema lives in `apps/pam/sql/0001_pam_vault.sql`
and is applied by `apply_app_schema` after the legacy schema.

- **Encryption.** Passwords are encrypted with AES-256-GCM under `PAM_MASTER_KEY` (base64 of 32 bytes,
  `openssl rand -base64 32`). The workspace and secret ids are bound in as associated data, so a ciphertext
  moved to another row does not decrypt. Without the key the vault refuses to run unless `DJANGO_DEBUG` is on.
  Keep the key outside the database and its backups.
- **Who sees what.** Staff (`can_manage`) read secret metadata through RLS. `authenticated` has no grant on
  the `ciphertext` column and cannot write `pam_events`; only the API's service-role paths decrypt, after the
  checks below. Custodians are workspace managers and administrators (`pam_is_custodian`, `pam.rego`).
- **Access.** Staff request access with a reason and a window (up to the secret's limit). Production secrets
  always need an approver (`pam_production_needs_approval`), and nobody approves their own request
  (`pam_requests_independent_approver`, plus an API check). Requests can only be inserted as pending. The
  password is revealed only to the requester, inside the approved window, with `Cache-Control: no-store`.
  Every reveal increments the request's count and writes an event.
- **Rotation.** `PAM_ROTATION_BACKEND=live` (the default without `DJANGO_DEBUG`; `ssh` is an older name for
  it) signs in as the account itself, changes its own password, then signs in with the new one to confirm:
  - *Unix (SSH)*: `passwd` over SSH. Host keys must be in `PAM_SSH_KNOWN_HOSTS`; unknown hosts are refused.
  - *PostgreSQL*: `ALTER ROLE CURRENT_USER WITH PASSWORD` over TLS (`PAM_DB_SSLMODE`, default `require`; use
    `verify-full` with `PAM_DB_SSL_CA` to check the certificate), connecting to `PAM_DB_DEFAULT_DATABASE`.
  - *MySQL*: `ALTER USER CURRENT_USER() IDENTIFIED BY`, with certificate checks when `PAM_DB_SSL_CA` is set.
    Database servers that log DDL statements will log the new password; keep statement logging off for these
    accounts.
  - *Windows local accounts*: ADSI `ChangePassword` over WinRM HTTPS (port 5986, NTLM, certificate
    validated; `PAM_WINRM_CA` for a private CA). Domain accounts are rotated in the directory instead.
  - *API keys* are issued by their provider, so they cannot be rotated generically: rotation fails with that
    message, and custodians replace the stored key after reissuing it.

  Database secrets name their engine (`database_engine`, PostgreSQL or MySQL). `simulated` (the default with
  `DJANGO_DEBUG`) only changes the vault copy. Rotation runs on demand,
  on schedule (`pam-rotate-due`, every 15 minutes, for secrets past `next_rotation_at`), and after a check-in
  or expiry when the password was revealed and the secret asks for it. Failures keep the old password and
  set `last_rotation_error`, retried after an hour.
- **Verification.** `pam-verify-secrets` (every 6 hours) signs in with the vaulted password for secrets that
  ask for it.
- **Log.** `pam_events` is append-only (update, delete and truncate raise), names the secret even after it is
  deleted, and never contains passwords.
- **Not included:** session proxying or recording. "Launch" from the legacy design is "Request access".

| Endpoint | OPA action | Enforced underneath by |
| --- | --- | --- |
| `GET /api/v1/orgs/{org}/pam/secrets` | `pam.read` | RLS (`can_manage`); risk and summary computed per secret |
| `POST /api/v1/orgs/{org}/pam/secrets` | `pam.manage` | `pam_is_custodian` + RLS insert policy |
| `GET, PATCH, DELETE /api/v1/orgs/{org}/pam/secrets/{id}` | `pam.read` / `pam.manage` | RLS; PATCH needs `expectedUpdatedAt` |
| `POST /api/v1/orgs/{org}/pam/secrets/{id}/{rotate\|verify\|password}` | `pam.manage` | `pam_is_custodian`, then the service role |
| `POST /api/v1/orgs/{org}/pam/secrets/bulk` | `pam.manage` | enable/disable rotation, verify, move to folder (up to 100) |
| `GET, POST /api/v1/orgs/{org}/pam/requests` | `pam.read` / `pam.request` | RLS: own requests, or all for custodians |
| `POST /api/v1/orgs/{org}/pam/requests/{id}/decision` | `pam.decide` | custodian, not the requester; DB check |
| `POST /api/v1/orgs/{org}/pam/requests/{id}/{reveal\|check-in\|cancel}` | `pam.request` | requester only (custodians may check in) |

## Run locally

For a production server (HTTPS, Keycloak, backups, upgrades), see [`deploy/README.md`](../deploy/README.md).

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
python manage.py apply_app_schema     # backend-owned SQL (apps/*/sql/NNNN_*.sql), e.g. the PAM vault
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
notes hidden from requesters, all three webhooks, and the PAM vault (encryption binding, column grants,
self-approval refused, reveal windows, rotation after check-in, the SSH rotator against a fake host). `tests/test_incident_workflow.py` mirrors the legacy
`tests/incident-workflow.test.ts` rules.

### Differences from the legacy command center

- Bridge links must be http(s). The legacy app accepted any text and rendered it as a link.
- Declaring is atomic. The legacy server function could create the bridge and then fail to flag the incident.
- Declaration notifications are sent. The legacy code inserted them as the signed-in user, but
  `notifications` has no insert policy, so those inserts were always refused (and the error ignored). Here
  the security-definer `itsm_notify_major_incident_declared` sends them in the declaring transaction to active
  managers, administrators, service desk and change managers (not the declarer), once per bridge. It takes
  only the bridge id: recipients and text come from the database, and only the declarer may call it.

### Support assistant

The legacy assistant called the Lovable AI gateway, which only exists inside Lovable hosting. This one calls the
Anthropic API (`anthropic` Python SDK) with `ANTHROPIC_API_KEY`; the model defaults to `claude-opus-5-5` and can
be changed with `ANTHROPIC_MODEL`. It streams the reply token by token over SSE (the API must run under ASGI,
as the Dockerfile does), uses low effort for short chat answers, and enables the server-side refusal fallback.
Ticket proposals come from a `propose_ticket` tool the model may call; its input is validated and clamped
before it is stored, and nothing is created until the employee confirms. The model only ever sees knowledge
articles and catalogue items the caller can read. Without a key the threads still load and the page says the
assistant is not configured. Tests replace the client with a fake and never call the API.

### Workspace isolation fixes to the existing schema

`apps/core/sql/0001_workspace_isolation.sql` (applied by `apply_app_schema`, so only to this backend's
database; the Lovable app's Supabase project is untouched) fixes three legacy gaps that matter once more than
one workspace exists:

- Record numbers (`INC0001001`, `REQ…`, `CHG…`, `KB…`) are unique per workspace, matching the per-workspace
  counters. They were unique across the whole database, so a second workspace failed on its first record.
- Anonymous visitors read published knowledge only from workspaces flagged `organizations.knowledge_public`.
  `manage.py sync_portal_workspace` (run after `apply_app_schema` in both compose files) sets the flag on
  `PORTAL_ORG_ID` alone. The legacy policy exposed every workspace's published articles.
- Major incident declarations notify responders (see above).

Policy tests needing OPA are skipped when no `opa` binary is found.

## Administration, invitations, profile, notifications and audit

| Method & path | Policy action | Backed by |
|---|---|---|
| `GET /api/v1/orgs/{org}/administration` | `admin.read` (admin) | `itsm_admin_overview` |
| `POST /api/v1/orgs/{org}/administration/invitations` | `admin.invite` | `itsm_admin_invite` |
| `POST /api/v1/orgs/{org}/administration/invitations/{id}/revoke` | `admin.revoke_invitation` | `itsm_admin_revoke_invitation` |
| `PATCH /api/v1/orgs/{org}/administration/members/{userId}` | `admin.update_member` | `itsm_admin_update_member` |
| `POST /api/v1/orgs/{org}/administration/groups`, `PUT …/groups/{id}` | `admin.save_group` | `itsm_admin_save_group` |
| `PATCH /api/v1/orgs/{org}/administration/workspace` | `admin.update_workspace` | `itsm_admin_update_workspace` |
| `GET, POST /api/v1/invitations/{id}` | `invitation.read` / `invitation.accept` (any signed-in person) | `itsm_get_invitation` / `itsm_accept_invitation` |
| `GET, PATCH /api/v1/me/profile` | `profile.read` / `profile.update` (self) | own `profiles` row; updates write a `profile` audit event in each workspace |
| `GET /api/v1/orgs/{org}/notifications` | `notification.read` (member) | 20 most recent for the caller; listing never marks read |
| `POST /api/v1/orgs/{org}/notifications/read-all` | `notification.update` | caller's unread rows only (RLS) |
| `GET /api/v1/orgs/{org}/audit?recordType=&action=&recordId=&before=` | `audit.read` (staff) | keyset-paginated `audit_events`, 50 per page; RLS shows administration evidence to admins only |
| `GET /api/v1/orgs/{org}/audit/facets` | `audit.read` | record types the caller can see |

Rules live in `policies/itsm/admin.rego`. Accepting an invitation needs no workspace membership. The
database compares the invitation with the verified email in `auth.users`, which is linked from Keycloak at
first sign-in. The API also requires the current token's verified email to match, so an address changed in
Keycloak after linking cannot use an invitation sent to the old one. Existing invitation links
(`/accept-invitation?invitation=<id>`) keep working.

## Coverage

Every screen of the current app now has an equivalent here. Known gaps, all of which the current app also
lacks or gets wrong:

- Business services can be listed but not created or edited (no screen in the current app either).

The legacy gaps in notifications, record numbering and public knowledge are fixed here (see "Workspace
isolation fixes" above).
