# Linked records on incidents, then a Security findings module

## Part 1: Show linked changes on an incident

Changes can already link to incidents and problems from the Changes page, but the incident page doesn't show those links.
- Add a **Linked records** panel to each incident. It lists the linked changes (number, title, state, risk) and the problem the incident belongs to, if any. Each item opens that record.
- Test it end to end: create a change, link it to an incident, then open the incident and check the change appears there.

## Part 2: Security findings module

### Findings (vulnerability fixes)
- Record a finding with:
  - Title, source (manual or a named scanner) and a reference such as a CVE or control ID.
  - Severity (critical, high, medium or low).
  - The affected service and assets.
  - A description.
- Each finding gets a number like `SEC0001001` from the shared numbering.
- Lifecycle: **Requested → Pending approval → Approved/Scheduled → Remediating → Delivered → Closed**, plus Cancelled.
- Every fix has an impact assessment, a fix plan, a test plan, a rollback plan and a rollback trigger. You can't submit it without them.
- Approvers in the security approval group sign off in Approvals, the same way as for changes. A rejection needs notes and cancels the fix.
- Scheduling sets a fix window and a deadline based on severity (for example critical: 7 days, high: 30, medium: 90, low: 180). Work can't start before approval, and delivery can't be recorded before the window opens.
- At delivery you record the outcome, the validation results, whether a rollback was used, and review notes.
- You can link an existing change or incident to a finding, or create a new change from it.

### Risk exceptions
- Instead of fixing a finding, you can request a risk exception. It needs a justification, other protections that reduce the risk, and an expiry date of at most one year.
- A manager or admin approves it. When it expires, the finding reopens automatically and the owner gets a notification.

### Findings from outside scanners
- A secure intake address that security scanners can send findings to. Each request is checked with a shared secret before anything is saved.
- If the same scanner reports the same reference again for the same asset, the existing finding is updated instead of duplicated.
- You'll need to add the shared secret when we set this up. I'll ask for it at that point.

### Across the workspace
- New **Security** page in the sidebar, with filters (severity, state, source, overdue, exceptions expiring soon) and a detail view.
- The dashboard gets counts for open critical/high findings, overdue fixes and exceptions expiring in 30 days, each linking to its queue.
- Global search finds findings by number, title or reference.
- Every step is recorded in the audit history.

## Who can do what
- Staff roles can view and update findings. Customers and portal users can't see them.
- Approval decisions and exception sign-off happen on the server, based on the person's role.

## Technical details
- Part 1:
  - `getIncidentLinks` server function in `change-links.functions.ts`. It uses `requireSupabaseAuth` and the database access rules apply.
  - An `IncidentLinkedRecords` component on the incident detail view.
- Part 2 migration:
  - Tables `security_findings` and `security_exceptions`. Use the existing `approvals` table with `record_type='security_finding'`.
  - `itsm_create_security_finding`, `itsm_transition_security_finding` and `itsm_upsert_scanner_finding` functions that run with elevated rights. The trigger that sets deadlines reuses `sla_instances`.
  - Expiry runs through a scheduled job that calls a public endpoint.
  - Grants, access rules and audit triggers that match the existing core tables.
- Endpoints: `src/routes/api/public/security-findings.ts`, which uses HMAC signing, Zod validation and a rate limit, and `src/routes/api/public/security-exceptions-expire.ts`, which uses cron auth.
- UI:
  - `src/routes/_authenticated/security.tsx` and `src/lib/security.functions.ts`.
  - Extend the dashboard, global search, approvals and sidebar.
- Tests: Zod schema tests for findings and exceptions, and checks on lifecycle gates. Then a Playwright run of request → approve → schedule → deliver, plus an exception approval.
