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
- **Knowledge base**: search and read articles.
- **Security findings**: staff only. Record a finding, submit the fix plan, approve or reject it, schedule the
  window, start, deliver and close the fix, link a change or incident, and request or decide risk exceptions.
  Requesters never load the board, and the nav item is hidden from them.

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
