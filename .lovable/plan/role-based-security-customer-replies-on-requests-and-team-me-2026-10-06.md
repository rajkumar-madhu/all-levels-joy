# Role-based security, customer replies on requests, and team members

## Who can do what
| Action | Allowed |
|---|---|
| Create tickets from the internal Incidents page | Staff: service desk, engineers, change managers, CAB members, CMDB owners, managers, admins |
| Raise a ticket as a non-staff person | Only through the Service catalogue's "Report an issue" form, the Support assistant's ticket offer, or the customer portal |
| Approve or reject changes | Change managers, CAB members, managers, admins. Nobody can approve their own change. |
| Approve catalogue requests | Managers, admins (unchanged) |
| Write, edit, publish knowledge articles and categories | Service desk, engineers, managers, admins |
| Use the customer portal | Only people with a confirmed **@wecrew.in** email |

Everyone keeps read access to what they can see today. The "New incident" button and the article editor are hidden from roles that can't use them. Anyone outside these rules who tries is refused by the database itself, not just the screen.

Effects to know about:
- The current portal test customer (`wecrew.portal.test+1006@gmail.com`) loses portal access. I'll create an @wecrew.in test customer instead.
- Change-manager-only and CAB-only accounts can still read articles but can't edit them.
- Portal users with other email domains see a "Please use your @wecrew.in email" message.

## Customer replies on catalogue requests (from the earlier plan)
- Staff can mark a request "Waiting on customer". Its due date pauses, and the portal shows "We need your reply".
- A portal reply resumes it to In progress and pushes the due date out by the time it waited. The assigned team is notified.
- Replies to closed or cancelled requests are saved, and the customer is asked to raise a new request.

## Team members
- Service Desk: rk.madhu2026, rajkumarmadhu2024, saasproduct2026
- Platform Operations: rk.madhu2026

You can change these later in Administration.

## Verification
- **Requester-only account:** the internal Incidents page refuses "New incident". The catalogue issue form and the Support assistant still create tickets. Editing an article is refused.
- **Change approval:** an account with only the change manager role can approve a change raised by someone else. A requester-only account is refused.
- **Portal:** an @wecrew.in test customer can sign in, submit and reply. A gmail account is blocked.
- **Request replies:** put a test request into "Waiting on customer", reply from the portal, and check it resumes with a later due date and the team is notified.
- Run the security scan afterwards.

## Technical details
- Migration:
  - `incidents_create` becomes `can_manage(organization_id)`.
  - New security-definer `itsm_self_service_incident(_org_id, title, description, impact, urgency, category, source)` for active members, used by the catalogue issue form and the assistant. It uses the shared numbering, routing trigger, rate limit and audit.
  - `knowledge_manage` and the category policies move to a new `can_author_knowledge(org)` helper (service_desk, fulfiller, manager, admin).
  - Change approver selection in `itsm_create_change` and the role check in `itsm_decide_approval` add `manager`.
  - New `portal_allowed()` helper: confirmed email whose domain is `wecrew.in`, read from `auth.users` inside the security-definer helper. It's enforced in `portal_submit_ticket` and `portal_reply`. The requester-read policies added for the portal are limited to org members or portal-allowed users.
  - Add `service_requests.awaiting_customer_since`, a pause/resume trigger on the request SLA, and a request branch in `portal_reply`.
- Code changes:
  - `itsm.functions.ts`: `createIncident` stays staff-only. Add `createSelfServiceIncident` calling the RPC, and add the waiting toggle to `updateServiceRequest`.
  - `assistant.functions.ts`: ticket creation goes through the RPC.
  - `catalog.tsx`: switch to the self-service call.
  - `incidents.tsx` and `knowledge.tsx`: hide controls by role, using new `canCreateTickets` / `canAuthorKnowledge` helpers in `itsm-shared.ts`.
  - `portal.functions.ts` / `portal.tsx`: domain message, request replies through the RPC, waiting note.
  - `requests.tsx`: "Waiting on customer" toggle and badge.
- Team member rows are inserted with the data tool.
- The allowed portal domain is saved to project memory. The role matrix is recorded in AGENTS.md.
