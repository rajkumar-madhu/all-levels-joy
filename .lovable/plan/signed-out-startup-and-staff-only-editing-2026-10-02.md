# Signed-out startup and staff-only editing

## What I found
- Signed-out visitors: workspace pages already sit behind the sign-in gate and redirect to sign-in. The workspace startup step (account setup + workspace load) only runs on those gated pages. No signed-out startup call was found in the code, but this has not yet been checked in a live signed-out browser session.
- Problems, problem links and major-incident bridges: only staff (service desk, fulfiller, change, CAB, CMDB, manager, admin) can create or change them. The database enforces this.
- Tickets (incidents): the app's edit action is staff-only. The database still lets the person who raised a ticket change its **title and description**. All other fields are locked to staff.

## Changes
1. **Confirm signed-out loading** with a real signed-out browser run of the landing page, sign-in page, customer portal and a protected page link. If any of them sends a sign-in-required request before sign-in, fix that request so it only runs after a session exists. Expected result: the signed-out pages load with no errors, and protected links send people to sign-in.
2. **Staff-only ticket editing:** tighten the incident update rule so only staff can change an existing ticket. Customers can still raise tickets and reply through comments or the portal, but can no longer edit a ticket's title or description after submitting.
3. **Make the startup step safe for signed-out callers:** if it's ever called without a session, the workspace setup call returns a clear "sign in required" result and doesn't throw.
4. **Verify:** sign in as staff and edit a ticket and a problem (both succeed). Sign in as a requester-only account and try to change a ticket or problem directly (both are refused). Then sign out and load the app (no errors).

## Technical details
- Migration: replace `incidents_update` policy with `USING/WITH CHECK (public.can_manage(organization_id))`, and remove the requester title/description allowance in `validate_incident_access` (non-staff UPDATE raises).
- `useWorkspace` in `src/components/app-shell.tsx`: enable the query only once `supabase.auth.getSession()` reports a session.
- Run the Supabase linter after the migration.
