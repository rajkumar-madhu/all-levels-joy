# Link a change to an incident and show it on the incident

You can already link incidents and problems to a change from the Changes page. But an incident page has no "Linked records" section yet, so the link never shows up on the incident itself. This plan adds that section and then tests the whole flow.

## What gets built
- A **Linked records** panel on the incident detail page that lists:
  - Changes linked to this incident, with number, title, state and risk. Each one opens that change in Changes.
  - The problem the incident belongs to, if there is one. It opens in Problems.
- Messages for loading, no linked records, and errors.

## Verification (signed in as the test account)
1. Open Changes and create a new change request with an impact assessment and a rollback plan.
2. In that change's links panel, link an existing incident.
3. Open that incident and check the new change appears under Linked records.
4. Click the change and check it opens the right record. Also check the database has the link row and the audit entry.

## Technical details
- New server function `getIncidentLinks` in `src/lib/change-links.functions.ts`. It uses `requireSupabaseAuth` and reads `change_links` where `record_type='incident'`, then joins in `changes` and the incident's `problem_id`. Database access rules (RLS) apply, with no admin client.
- New `IncidentLinkedRecords` component, shown in the incident detail panel in `src/routes/_authenticated/incidents.tsx`. It uses `useQuery` keyed by incident id. Linking or unlinking from the change panel refreshes it.
- No database changes.
