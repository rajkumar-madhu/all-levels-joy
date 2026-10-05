# Portal replies follow the same queues and deadlines, plus tracking on the dashboard

## What changes for people
- **Customer replies in the portal now move the ticket along:**
  - If the ticket was waiting on the customer, a reply puts it back to In progress. Its target date is pushed out by however long it sat waiting, so the team doesn't lose time.
  - If the ticket was Resolved, a reply within 7 days reopens it. It goes back to its original team, the reopen count goes up, and it gets a fresh target date based on its priority.
  - If the ticket is Closed or Cancelled, the reply is saved, but the customer is asked to open a new ticket.
  - The assigned team is notified of every customer reply.
- **The deadline clock pauses while a ticket waits on the customer.** When staff set a ticket to "Pending – awaiting caller", its deadline stops counting until the customer replies.
- **The portal shows the live status and target date**, using the same numbers staff see, and refreshes after a reply.
- **A new "Request queues" panel on the dashboard** shows open requests by team and priority, with on-track, at-risk and breached counts. Each row links to the filtered Service requests list.

## Verification
1. Submit a new test request through the Service catalogue. Confirm the team, priority and target date, then confirm it appears in the dashboard panel and its link opens it.
2. Sign up a new test customer through the Customer portal sign-in page. New accounts need email confirmation, so I'll confirm the test account on the backend instead of using an inbox.
3. As that customer, submit a test ticket. Confirm it gets the next incident number, the correct team, priority and target date, and appears in your Incidents queue.
4. Put that ticket into "awaiting caller", reply from the portal as the customer, and confirm the status goes back to In progress and the target date moves later.
5. Resolve the ticket, reply again, and confirm it reopens with a new target date.
6. Leave the test records and the test customer labelled "TEST".

## Technical details
- New migration:
  - A `portal_reply(_incident_id, _body)` security-definer RPC that checks the caller is the requester, inserts a non-internal `record_comments` row, and applies the state changes above. It updates `sla_due_at` and the running `sla_instances` row: pause/resume via `paused_at`, extended by the paused interval; on reopen, the old row is closed and a new resolution row inserted. It also adds an audit event and team notifications.
  - A trigger on `incidents` that sets `paused_at` when the state becomes pending/awaiting_caller.
  - EXECUTE granted to authenticated only.
- `src/lib/portal.functions.ts`: the reply calls the RPC instead of a direct insert. `src/routes/portal.tsx` invalidates the ticket query after a reply.
- `src/routes/_authenticated/dashboard.tsx`: new request-queue panel, built from the existing requests data plus group names.
- Existing RLS stays as is: requesters still can't update incidents directly.
