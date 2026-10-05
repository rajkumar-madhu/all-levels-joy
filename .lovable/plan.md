# Customer replies on catalogue requests, plus team members

## What changes for people
- **Staff can mark a catalogue request "Waiting on customer"** from the Service requests page. While it waits, its due date stops counting down, and the customer sees a "We need your reply" note in the portal.
- **A customer reply in the portal resumes the request.** It goes back to In progress, and its due date is pushed out by however long it waited. The assigned team is notified.
- **Replies to closed or cancelled requests** are saved, and the customer is asked to raise a new request.
- **Team members, set up so reply notifications reach real people:**
  - Service Desk: rk.madhu2026, rajkumarmadhu2024, saasproduct2026
  - Platform Operations: rk.madhu2026

  You can change these later in Administration under Groups.

## Verification
- Put test request REQ0001003 into "Waiting on customer", reply from the portal as its requester, and confirm it's back In progress with a later due date.
- Confirm Platform Operations members are notified of the reply.
- Reply on test incident INC0012853 again and confirm the Platform Operations members get that notification.

## Technical details
- Migration:
  - Add a nullable `service_requests.awaiting_customer_since timestamptz`.
  - Add a BEFORE UPDATE trigger that pauses/resumes the request's `sla_instances` row, shifting `due_at` by the paused interval, mirroring the incident trigger.
  - Extend `portal_reply` with a request branch, or add a separate `portal_reply_request` RPC: requester check, non-internal comment, resume, team/assignee notifications, audit event.
- `src/lib/itsm.functions.ts`: `updateServiceRequest` accepts the waiting toggle (staff only, same role checks).
- `requests.tsx`: add a "Waiting on customer" toggle and badge.
- `portal.functions.ts` / `portal.tsx`: route request replies through the RPC, and show the waiting note.
- Team membership rows inserted with the database data tool, not a migration.
