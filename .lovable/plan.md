# Test a Service catalogue request end to end

## What I'll do
1. Sign the preview in as the admin test account and open the Service catalogue.
2. Submit a test request for **Software installation**, which should go to Platform Operations at Low priority. Then submit one for **New laptop**, which should go to Service Desk at Moderate priority.
3. After each one, check the confirmation shows the team, priority and target date.
4. Open Service requests and check each new ticket:
   - It has the next number in the sequence.
   - The team and priority columns match.
   - It appears under the right queue filter.
5. Check the stored records: team, priority, due date, the deadline-tracking entry, approval status and the audit entry.
6. Report what matched. If anything doesn't match, fix it in the same pass and re-run the test.
7. Leave the test requests labelled "TEST" so your team can cancel them, or I can cancel them for you.

## Technical details
- Use a Playwright script against `/catalog` and `/requests`. Verify with read queries on `service_requests`, `sla_instances` and `audit_events`, and check against `catalog_items.default_group_id/default_priority`.
- Code changes only if a mismatch is found, in `itsm_create_service_request` or `src/routes/_authenticated/catalog.tsx`.
