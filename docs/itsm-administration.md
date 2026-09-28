# Administration and access

The `/administration` workspace is available to active administrators. The sidebar displays the administrator role first and shows the number of additional roles. Permissions are checked again in PostgreSQL for every read and mutation; hiding a navigation item is not the access boundary.

## Operator workflow

- **Members:** search by name or email, filter active/inactive access, inspect every assigned role, and review/confirm access changes. Requester is the baseline role. Disable access without deleting historical work; reactivate only through an explicit administrator action. At least one active administrator must remain.
- **Invitations:** create an invitation for a specific email and role set, copy its acceptance link, and share it using your organization's channel. No email is sent by this implementation. Invitations expire after seven days and can be revoked. A new invitation replaces an expired pending invitation.
- **Acceptance:** the recipient signs in with the same verified email and explicitly accepts. Sign-in preserves the invitation URL. A wrong, unverified, disabled, expired, revoked, or already-used admission cannot grant access. Acceptance clears orphan roles in that workspace before assigning exactly the invited roles; it cannot reactivate a disabled membership.
- **Assignment groups:** create/edit a named group, select up to 500 active workspace members, and archive/reactivate groups. Archived groups remain visible on historical records but cannot receive new incident/request assignments. Editing a group explicitly warns when inactive/former members will be removed on save.
- **Workspace settings:** edit the name and default IANA timezone. This does not recalculate existing SLA deadlines or change individual profile timezones.

The member list shows 25 entries per page from a complete administrator-only snapshot. Invitations and groups also come from that complete snapshot, without a silent 1,000-row API cap. This is suitable for the current workspace; database pagination and load testing are future scale work.

## Concurrency and audit guarantees

Administration RPCs serialize on the workspace row and recheck the caller's active administrator role after acquiring that lock. This prevents two administrators from concurrently removing the last administrator and prevents a waiting mutation from using an administrator role revoked while it waited. Member, group, invitation, and workspace changes include version checks so stale forms cannot overwrite newer edits.

The administration screen refreshes its data after a rejected mutation as well as a successful one. An open editor retains the values you were reviewing; after a version conflict, cancel and reopen it to load the latest roles, group details, or workspace settings. The rejected change is never automatically retried or merged into another administrator's update.

Direct authenticated table writes cannot bypass these RPCs. Invitation identity uses the verified email in `auth.users`, not caller-supplied email or JWT email metadata. The application uses its existing user-scoped Supabase client; there is no runtime service-role credential.

Database AFTER triggers write structured before/after evidence for workspace settings, memberships, roles, groups, group membership, and invitations. Evidence is immutable through normal access and readable only by active administrators. Audit failure rolls back the originating transaction, including invitation acceptance and role changes. Non-administrator operators retain their existing access to core operational audit only. Audit contains identity/access metadata; it excludes passwords, tokens, and group descriptions.

## Compatibility and limitations

Deactivating a historical request assignee or change owner must not prevent authorized operators from continuing that record. Migration `0009` validates active ownership only on creation or when that reference changes. New assignments still require an active member. Group archival similarly preserves existing assignments.

Pending approvals keep their designated reviewers. Disabling a reviewer or removing their approval role can block an outstanding approval. The access editor warns about this; review the pending workload when possible. Immediate deactivation remains available. Resolution may require restoring authorized access or cancelling and resubmitting the record. Automatic delegation/reassignment is not implemented.

This release still uses the application's fixed workspace. It does not provide organization switching, SAML/SCIM provisioning, custom role definitions, approval delegation, automatic invitation email, team-based routing, or business-calendar SLAs. Existing roles are preserved on migration and should be reviewed by an authorized administrator. Previously generated audit history is not backfilled.

## Deployment

1. Apply and verify the existing migration chain through `0007`.
2. Check existing organization/group names are trimmed and 2–120 characters, and group descriptions do not exceed 1,000 characters. Review the active administrator count and take the environment's database backup or targeted recovery snapshot.
3. Apply `0008_workspace_administration.sql` and `0009_administration_assignment_compatibility.sql` in order, with their matching Drizzle ledger entries. The release procedure verifies all earlier migration hashes and runs schema changes in one transaction.
4. Deploy the matching application revision and verify `/administration` and `/accept-invitation` signed-out redirects, then verify authorized access using an administrator account.
5. Verify existing memberships/roles and operational record counts remain unchanged. Do not create real invitations or change live roles as a smoke test.

An application rollback may retain these additive schema changes. Do not delete administration evidence or remove the new admission boundary to restore older behavior. Database rollback after real administration activity needs an explicit recovery plan that preserves access and audit history.

See [verification](./itsm-validation.md) for repeatable SQL and actual authenticated browser tests. Release-specific evidence distinguishes local end-to-end behavior from hosted read-only verification.
