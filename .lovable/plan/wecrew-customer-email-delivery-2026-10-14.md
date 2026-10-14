# WeCrew customer email delivery

## Requested outcome
Use your owned domain **wecrew.in** for portal account confirmations and customer-visible support replies. Send the first tests only to **info@wecrew.in**, not a customer backlog.

## Setup
1. Complete the sender-domain setup for wecrew.in using the setup dialog. Use its verified sending subdomain and exact DNS records; do not change website hosting or existing mailbox records unnecessarily.
2. Generate WeCrew-branded authentication templates and a support-reply email template through Lovable's managed email service. Implementation can proceed while DNS verification is pending; actual sends wait for verification.
3. Keep account confirmation enabled. Check hosted auth settings and ensure confirmation links work on the published portal.

## Customer replies
- Email the requester when an authorized staff member posts a new public reply on their incident or service request.
- Include the record number, public reply and a link to that customer's record in the portal. Never email internal notes, customer-authored replies, or another customer's records.
- Resolve recipients securely from the saved record, not an email address supplied by the browser.
- Avoid duplicate sends and preserve the saved reply if delivery fails. Show an honest delivery result rather than claiming an email was sent.
- Add a standard resend-confirmation action to portal sign-in, with rate-limit feedback.

## First live tests
1. Check the actual state of info@wecrew.in. If unconfirmed, resend its real confirmation email; if already confirmed, send a branded template test without resetting its account or inventing a confirmation link.
2. Use a clearly labelled test ticket owned by info@wecrew.in, post a staff public reply and verify its email-send result. Post an internal note and confirm it sends no email.
3. Check delivery events in Cloud → Emails and report accepted, rejected or blocked outcomes accurately. Ask you to confirm inbox receipt; delivery logs alone do not prove receipt.
4. Verify the emailed portal link opens the customer's own record after sign-in. Do not bypass the confirmed-company-email portal restriction.

## Technical details
- Verified current state: no Lovable sender domain is configured; portal sign-up uses standard Cloud Auth confirmation, while the staff comment function currently saves replies without an email trigger.
- Use managed auth/app email scaffolding, TanStack server-side sending and the generated send helper; do not add a third-party provider, email queue, cron job or email tables.
- Use the saved comment ID for send idempotency. Enforce staff authorization and record access before looking up the recipient through privileged server-only code.
- Respect suppression and rate limits. Add regression tests for staff-only public reply sends, internal-note exclusion, recipient ownership and duplicate-send protection.
- Verify preview/build checks and deploy the email changes with the app when publishing is authorized; live behavior cannot be claimed verified until those changes are published.

## Boundaries and blockers
- No bulk resend, status-change notifications or ticket-received emails in this request.
- DNS verification may take up to 72 hours and requires your domain setup action.
- Real sends remain blocked until verification; confirmation of inbox receipt requires your check of info@wecrew.in.