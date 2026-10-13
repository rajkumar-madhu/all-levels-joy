<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Security findings change state only through security-definer RPCs (`itsm_*security*`); tables are read-only to staff via RLS. Why: lifecycle gates, approvals and audit stay atomic in the database.
- Scanner findings arrive at `/api/public/security-findings` signed with HMAC (`SECURITY_SCANNER_SECRET`) and dedupe on scanner+reference+asset. Why: external callers bypass site auth.
- Scanner intake maps assessment, remediation and workspace-scoped asset references into existing security findings; repeated scans preserve approved plans and lifecycle state. Why: scanners and manual findings share one review workflow without bypassing approvals.
