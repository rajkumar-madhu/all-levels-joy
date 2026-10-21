# ITSM web app (React SPA)

Single-page app for the replatformed ITSM workspace. It talks to the Django API in `../backend` and signs in
with Keycloak.

| Concern | Choice |
|---|---|
| Build | Vite 8, React 19, TypeScript (strict) |
| Styling | Tailwind CSS 4 |
| Data | TanStack Query (`src/api/hooks.ts`), one fetch wrapper (`src/api/client.ts`) |
| State | Zustand: session and active workspace (`src/stores/session.ts`), UI (`src/stores/ui.ts`) |
| Routing | React Router (`src/router.tsx`) |
| Icons | lucide-react |
| Sign-in | `oidc-client-ts`, authorization code + PKCE against the Keycloak `itsm` realm |

## Screens

- **Dashboard**: open incidents, incidents past their SLA target, approvals waiting for you, and active
  security findings for staff.
- **Incidents**: queue for staff, own tickets for requesters (the API's row-level security decides). Filter,
  search and raise a ticket. Staff assign to themselves, route to a group, change impact or urgency, put on
  hold with a reason, resolve with notes and a close code, and reopen. Only valid next states are offered.
- **Conversation** on incidents and requests: requesters and staff comment; staff can add internal notes
  that requesters never receive.
- **Requests and service catalogue**: browse the catalogue and ask for an item. Requests that need approval
  wait for an independent manager. Fulfilment staff move requests on, with stale-edit protection.
- **Changes**: plan standard, normal or emergency changes in your own timezone. Change managers start,
  deliver and close them after CAB approval.
- **Approvals**: the requests and changes waiting for your decision.
- **Incident work queues**: Active, Assigned to me, Unassigned, Due within 1h, Breached, Resolved and All
  records with live counts, filters for priority, group and service, sorting and paging (all kept in the URL).
  Staff can **log an incident** taken by phone, email or at the desk, already routed to a group and service.
- **Assets & CMDB** (staff): configuration items with status, criticality, service and relationships; CMDB
  owners and admins add and edit them.
- **Catalogue administration** (managers, admins): routing group, priority, approval and retiring items, from
  the Service catalogue page.
- **Fulfilment tasks** on service requests and **linked records** on changes and incidents (staff).
- **Major incident command** (`/command-center?record=<id>`, staff only): declare a bridge from an active
  incident, take command or comms, change bridge state, escalate, link a problem, and post internal, customer
  or executive updates on a cadence. Refreshes every 30 seconds and flags overdue updates.
- **Support assistant** (`/assistant`): conversations with the AI assistant; replies stream in as they are
  written, cite knowledge articles, and can include a ticket proposal the employee raises with one click.
  Markdown is parsed into React elements (`src/lib/markdown.ts`), so model output can never inject HTML.
- **Integrations** (`/integrations`, administrators): configured channels, intake URLs to copy, scheduled jobs and
  tool reachability. Secret values are never shown.
- **Customer portal** (`/portal`, its own layout): public knowledge search without signing in; signed-in
  requesters with a company email raise tickets, follow them, see workarounds and outage updates, and reply.
- **Knowledge base**: search and read articles.
- **Knowledge authoring** (service desk, engineers, managers, admins): write articles, move them through
  draft, review, published and retired, tag them, and manage categories. Edits are refused if someone saved
  the article after you opened it.
- **Problems** (staff): list open problems and known errors, raise a problem, link and unlink incidents, record
  workaround, root cause, fix plan and resolution, and link a known-error article.
- **Security findings**: staff only. Record a finding, submit the fix plan, approve or reject it, schedule the
  window, start, deliver and close the fix, link a change or incident, and request or decide risk exceptions.
  Requesters never load the board, and the nav item is hidden from them.
- **Secrets vault** and **Access requests** (staff, under *Privileged access*): secrets sorted by risk with
  summary cards, environment tabs, a "used, never rotated" filter and a detail panel with the risk reasons,
  rotation policy and activity. Managers and administrators add secrets, rotate and verify them, run bulk
  actions and approve requests. Staff request time-boxed access, reveal the password inside the window (it
  is cleared from the page after 60 seconds), copy it and check in.
- **SLA performance**: open requests and incidents per team, what is due within 24 hours, and what is breached
  now (requesters see their own tickets only).
- **Incident insights** (staff nav): 30-day volumes, mean time to resolve and to first response, SLA
  attainment, a 14-day opened/resolved chart drawn to scale in SVG, breakdowns and the oldest open incidents.
- **Service targets and history** on incidents and requests: SLA targets (met, running, paused, breached) and a
  timeline built only from recorded audit snapshots.
- **Attachments** on incidents and requests: upload up to 25 MB; downloads go through the API, which checks
  access each time. There are no public file links.
- **Global search** in the header: incidents, requests, changes, knowledge, catalogue, security findings and
  assets you are allowed to see.
- **Administration** (admins only): members (search, access filter, 25 per page, roles and access with
  stale-edit protection and approver warnings), invitations (create, copy the acceptance link, revoke),
  assignment groups (create, edit, archive), and workspace name and timezone.
- **Accept invitation** (`/accept-invitation?invitation=<id>`, `?token=` also accepted): needs sign-in but no
  workspace, and shows the workspace, roles and expiry before you accept.
- **Profile** (from the sidebar profile block): name, contact details, department, locale, timezone and the
  email digest preference.
- **Notifications**: a header bell with your 20 most recent notifications. Opening it does not mark them
  read; **Mark all read** is a separate action.
- **Audit trail** (staff): read-only, filter by record type and action, load older entries page by page.

## Look and feel

The app uses the existing Argus theme. `src/index.css` copies the design tokens from the old app's
`src/styles.css`, including the `.dark` palette. The shell and badges reproduce its sidebar, outlined state
and priority badges, KPI cards and table headers. Dark mode follows the operating system. Keep the tokens in
sync with `../src/styles.css` until the old app is retired.

Sidebar labels are also the page titles and breadcrumb text, and the icons come from one lucide import. This
fixes the label-mismatch and duplicate-import findings from the code review of `src/components/app-shell.tsx`.

Fix-window and exception-expiry times are converted from local time in the browser by
`src/lib/security-window.ts`, a copy of the existing helper. The API accepts only offset-aware timestamps.

## Run

```sh
cd frontend
cp .env.example .env.local   # Keycloak authority and client id
npm install
npm run dev                  # http://localhost:5173, proxies /api to http://localhost:8000
```

Start the backend stack first (`cd ../backend && docker compose up`).

## Check

```sh
npm run typecheck
npm test        # node:test on the pure helpers (date windows, SLA labels, API error messages)
npm run build
```

The production build is static files in `dist/`. Serve them behind the same ingress as the API, with `/api`
routed to Django, and redirect unknown paths to `index.html`.
