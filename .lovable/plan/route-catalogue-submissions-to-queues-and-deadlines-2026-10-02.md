# Route catalogue submissions to queues and deadlines

## What exists today
- **Service requests** (for example New laptop, Application access, Software installation) only get a due date based on the item's delivery days. They aren't given a priority or a team, and no deadline tracking record is created.
- **Report an issue** creates an incident. Its priority and deadline come from the impact and urgency you choose, but it is only routed to a team if a team is chosen on the form.
- The workspace has two teams: Service Desk and Platform Operations. No routing rules are stored anywhere yet.

## What will change
1. **Routing rules on each catalogue item:** each item gets a default team and a default priority (Critical, High, Moderate or Low). These start with sensible values:
   - New laptop: Service Desk, Moderate
   - Application access: Service Desk, Moderate
   - Software installation: Platform Operations, Low

   Admins can change these values in the catalogue.
2. **Issue-area routing:** each "Report an issue" area is mapped to a team. Network and Infrastructure go to Platform Operations; Hardware, Software, Access and Other go to Service Desk. The issue's priority still comes from impact and urgency.
3. **Deadlines (SLAs) by priority:**
   - Requests: the delivery due date is the item's delivery days, shortened for higher priority (Critical 1 day, High 2 days, otherwise the item's days).
   - Issues: the existing response deadlines stay as they are (2, 8 or 24 hours).

   Both now also create a tracked deadline record, so "at risk" and "breached" views work.
4. **Queues:** the Requests page gets priority and team filters plus "Unassigned team", "At risk" and "Breached" views, like the incident queue. Submissions appear in the right team's queue immediately.
5. **Confirmation:** after submitting, the person sees the ticket number, the team and the target date.
6. **Verify:** submit one request and one issue from each routing path, then check the team, priority and deadline on each record and that it appears in the matching queue.

## Technical details
- Migration:
  - add to `catalog_items`: `default_group_id` (references groups) and `default_priority` (smallint, default 3, 1–4)
  - add to `service_requests`: `priority` (smallint, default 3)
  - backfill the three items' values
  - update `itsm_create_service_request` to set `group_id`, `priority` and the priority-adjusted `due_at`, and to insert an `sla_instances` row (`target_type` `fulfilment`)
- `createIncident`: when no team is given, resolve it from a category→group map in a shared server helper. Then insert an `sla_instances` row (`target_type` `response`) with the incident's `sla_due_at`.
- Catalogue admin editing goes through a staff-only server function (admin or manager).
- `src/routes/_authenticated/requests.tsx`: add the queue filters. `catalog.tsx`: confirmation details plus admin routing editor.
