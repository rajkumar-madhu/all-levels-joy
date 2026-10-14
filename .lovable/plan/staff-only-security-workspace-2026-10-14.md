# Staff-only security workspace

## Outcome
Give staff a direct **Security workspace** entry from the customer portal landing page and the main WeCrew landing page, opening the existing Security findings workspace rather than creating a second system.

## Workspace
- Retain the findings register, severity/search filters, impact assessments, remediation/test/rollback plans, approval workflow, local-time fix windows, delivery evidence and risk exceptions.
- Keep each finding's history and linked incidents/changes available in the same workspace.
- Signed-out visitors follow the staff sign-in flow and return to `/security` afterwards.
- Signed-in customers or requester-only users see a clear staff-access restriction, never a misleading empty findings register or editable security form.

## Access and privacy
- Verify staff permission before loading the security board or related incident/change choices. Apply the check in the server function, not just the page.
- Preserve existing database protections: live findings and risk-exception SELECT policies require `can_manage`, whose live definition requires organization membership and a protected staff role.
- Retain the security-definer lifecycle RPCs for all finding changes and approvals. Do not grant direct table edits or weaken independent approval safeguards.
- Keep public Knowledge and customer ticket access unchanged; the public landing link exposes no finding data.

## Verification
- Test a signed-out portal visitor clicking the security link, signing in as staff and arriving at the findings workspace.
- Confirm staff can open a real finding and inspect its assessment, remediation status, window and history without changing its lifecycle just for a test.
- Verify a customer/requester session cannot read security findings or risk exceptions, retrieve related workspace data through the security-board function, or perform finding mutations.
- Check desktop and narrow layouts for the new links and access-denied view, and run relevant access regression tests and preview checks.

## Technical details
- Reuse `src/routes/_authenticated/security.tsx`, `src/lib/security.functions.ts`, the existing security workflow and shared timezone helper.
- Add the explicit server-side staff check to security-board reads and a permission-aware page state that does not fetch protected data for known non-staff users.
- Add links in `src/routes/portal.tsx` and `src/routes/index.tsx`, using the existing sign-in return path. Preserve unique page metadata and update metadata only on touched content pages as needed.
- No new security schema or duplicate route is planned; verify any further access gaps before changing them.
- In build mode, record this task and the pending team-email task in `roadmap.md` before source edits.

## Pending team-email request
Adding real people to **Service Desk** and **Platform Operations** remains a separate task. You selected email notifications, but did not provide staff assignments. Do not guess identities, change roles or assign people from an old sample list. Membership setup needs the work email/team list; actual email sending also needs verified sender-domain setup. This does not block the security workspace work.