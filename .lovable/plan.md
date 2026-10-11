# Verify customers can't edit tickets, staff can

## What I confirmed already
- The database rule for changing an incident (`incidents_update`) requires staff access (`can_manage`) for both reading the row and saving the change. Customers are not staff, so the database itself refuses their edits — this is not just a hidden button.
- Test accounts available: staff accounts (rk.madhu2026, saasproduct2026, rajkumarmadhu2024 — all have service desk or higher roles) and the portal test customer (no staff role).

## What I'll do
1. **Staff edit (should work):** sign the preview in as a staff account, open an existing incident, change a field (e.g. assign it or move its state), and confirm the change saves.
2. **Customer edit (should fail):** sign in as the portal test customer, who has tickets they raised. Try to change their own ticket's title directly against the database API with their session, and confirm it is refused with a permission error and the ticket is unchanged.
3. **Customer can still read and reply:** confirm the customer can still open their ticket in the portal and post a reply (replies are comments, not edits).
4. Report both outcomes. If the customer edit unexpectedly succeeds, I fix the policy in the same pass and re-test.

## Technical details
- Playwright against the preview for the staff sign-in and edit; the customer's update attempt runs through the Supabase Data API with the customer's own session token (RLS applies as that user).
- No code or schema changes expected — this is a verification pass on rules already in place.
