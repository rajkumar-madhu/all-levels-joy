# SLA dashboard per team

## What exists today
- The operations dashboard already has a "Request queues" panel with per-team, per-priority on-track / at-risk / breached counts, linking into the filtered Requests page.
- Incidents and requests both carry due dates; the `slaState` helper classifies on track / at risk / breached. The `sla_instances` deadline records exist but are not read by any page yet.
- Global search finds records (incidents, requests, changes, knowledge, assets, catalogue, security findings) but has no page-level entries.

## What will change
1. **New SLA dashboard page** (`/sla`):
   - One row per team (Service Desk, Platform Operations, Unassigned) showing: open requests, open incidents, deadlines due within 24 hours, and breached counts — requests and incidents side by side.
   - Each number links into the matching filtered queue (Requests page team/priority filters, incident queue).
   - A "breached now" list naming the actual tickets (number, title, team, how overdue) so staff can act immediately.
   - Data comes from the existing workspace load (requests + incidents with due dates), classified with the existing `slaState` helper — no new database reads needed.
2. **Dashboard wiring:** the existing "Request queues" panel gains an "Open SLA dashboard" link, and the SLA breached / at-risk metric cards link to the new page.
3. **Global search wiring:** searching "sla", "deadline" or "breach" surfaces a "SLA dashboard" entry that navigates to the new page.
4. **Verify:** sign in as staff, open `/sla`, confirm the per-team counts match the Requests page filters and incident queue, and confirm the search entry appears and navigates.

## Technical details
- New route `src/routes/_authenticated/sla.tsx` with its own head() metadata (title "SLA dashboard — WeCrew ITSM", description, og tags).
- Reuses `useWorkspace`, `referenceQuery` (groups), `slaState`, `formatDateTime` from `itsm-shared`; pure client-side aggregation, no new server functions or migrations.
- Global search: add a static "Pages" group in `src/components/global-search.tsx` matched on keywords (sla, deadline, breach, due).
- Dashboard edits limited to `src/routes/_authenticated/dashboard.tsx` (link + metric card targets).
