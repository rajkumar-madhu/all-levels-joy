# Core ITSM rollout notes

The code and migration chain through `0007` have been validated locally. Release-specific migration results, deployed revision and live checks are recorded in the release evidence. Deploy the matching database and application changes together using the target environment's existing runner. This repository has both `supabase/migrations` and `drizzle/migrations`; applying only one directory is insufficient.

## Existing-data compatibility

1. Review existing memberships and roles before rollout. Earlier bootstrap code automatically provisioned elevated roles and reactivated accounts. Migration `0005` stops that behavior but preserves existing assignments because it cannot distinguish deliberate grants from automatically created grants.
2. Provision active membership explicitly before a user signs in. Bootstrap creates only a missing profile and requester role. An invitation/admin UI and organization selection are still separate product work; no runtime service-role secret is needed for bootstrap.
3. Review duplicate designated approvers before `0006`. Its unique index deliberately rejects duplicates instead of silently deleting decisions. This read-only query identifies them:

```sql
SELECT organization_id, record_type, record_id, approver_id, count(*)
FROM public.approvals
GROUP BY organization_id, record_type, record_id, approver_id
HAVING count(*) > 1;
```

4. Review legacy approval-controlled records with missing, stale or conflicting approval rows. Migrations do not invent historical decisions or eligible approvers. Records may need controlled remediation or resubmission. A designated approver deactivated after submission cannot decide; delegation/reassignment is not implemented.
5. Update integrations that directly insert requests/changes or mutate approvals. They must use the authenticated `itsm_create_service_request`, `itsm_create_change` and `itsm_decide_approval` RPCs. Submitted scope is immutable; changed requirements require a new submission. Standard changes retain their existing approval exemption; approved standard-change templates remain future work.
6. Upgrade incident clients to send the `expectedUpdatedAt` token and required hold/resolution evidence. Request/change updates must respect approval and lifecycle gates. Tightened requester visibility and Storage policies also apply to direct API clients.
7. Plan retention/offboarding before organization deletion. Core audit rows reject update/delete/truncate through normal access, including cascading deletion. Removing organizations therefore needs a controlled retention/export design. Privileged database owners can still change schema protections; this is not an external tamper-proof audit archive.

Validate the migration against a staging copy with representative historical records and approved access assignments. Confirm backups and use the environment's deployment/rollback process. Avoid recreating auto-enrollment or bypassing audit/approval gates as a rollback shortcut.

## Connected hosting target

The main branch syncs to Lovable project `cbb4ee71-8a85-4a8a-abca-350f15b8c3d4`, with Supabase project `ffymghdmzidrtvpoyxod`. Git synchronization and publishing are distinct steps. Verify the project has the intended commit before publishing, then check the returned live URL.

For the 28 September release preflight, the remote Drizzle ledger matched the checked-in migrations through `0003`. There were no duplicate designated approvers, no service requests or approvals to backfill, and one active administrator. Seeded normal change `CHG0004182` had no approval rows; it remains blocked pending controlled resubmission or approval setup. The UI explicitly reports that missing configuration. Existing role assignments are preserved; the migration prevents future automatic staff grants.

The separate `k8s-self-host-prep` branch is preparation for another hosting target and is not part of the connected Lovable release.
