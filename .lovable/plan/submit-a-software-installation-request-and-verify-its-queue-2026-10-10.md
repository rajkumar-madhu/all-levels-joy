# Submit a Software installation request and verify its queue

## What I confirmed already
- The catalogue item "Software installation" is routed to the Platform Operations team with Low priority and a 2-day delivery target, and needs no approval.
- The Requests page already shows team, priority and due-date columns plus team/priority filters.

## What I'll do
1. Sign the preview in as the staff test account and open the Service catalogue.
2. Select "Software installation", submit a request titled "TEST Software installation queue check" with test details.
3. Check the confirmation shows the ticket number, Platform Operations team, Low priority and the target date.
4. On the Requests page (it opens automatically after submitting), confirm the new ticket row shows:
   - Team: Platform Operations
   - Priority: Low
   - A due date about 2 days out
5. Filter the Requests page by the Platform Operations team and confirm the ticket appears there.
6. Double-check the stored record (team, priority, due date, deadline-tracking entry) matches what the page shows.
7. Report the ticket number and results. The test ticket stays labelled "TEST" so your team can cancel it, or I can cancel it for you.

## Technical details
- Playwright against `/catalog` and `/requests` in the preview, signed in as the staff test account.
- Verification reads on `service_requests` and `sla_instances` compared against `catalog_items.default_group_id/default_priority`.
- No code changes expected; only if a mismatch is found, fix it in the same pass and re-run the test.
