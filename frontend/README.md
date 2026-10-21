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
- **Major incident command** (`/command-center?record=<id>`, staff only): declare a bridge from an active
  incident, take command or comms, change bridge state, escalate, link a problem, and post internal, customer
  or executive updates on a cadence. Refreshes every 30 seconds and flags overdue updates.
- **Knowledge base**: search and read articles.
- **Security findings**: staff only. Record a finding, submit the fix plan, approve or reject it, schedule the
  window, start, deliver and close the fix, link a change or incident, and request or decide risk exceptions.
  Requesters never load the board, and the nav item is hidden from them.
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
