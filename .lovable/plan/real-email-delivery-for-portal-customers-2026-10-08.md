# Real email delivery for portal customers

## What customers will get
- **Account confirmation emails sent from your own domain.** For example, "WeCrew Support <no-reply@notify.wecrew.in>". They use WeCrew branding instead of the default sender. The same change covers password-reset and email-change emails.
- **An email when support replies.** When staff post a public update on a customer's ticket or request, the customer gets an email with:
  - the ticket number
  - the reply
  - a "View in portal" button
  Internal notes never send an email.
- **An email when the ticket status changes.** This covers resolved, waiting on your reply, reopened and closed. It shows the new status and, where there is one, the target date.
- **A confirmation email when a customer submits a ticket or request in the portal.** It includes the number and target date.
- Every email has the standard unsubscribe footer, which can't be removed. Sign-in and password emails always arrive, even for someone who has unsubscribed.

## What you need to do first
1. **Set up your sender domain.** Use `wecrew.in` (or another domain you own), and add the DNS records shown during setup. Emails start sending once the domain is verified, which can take up to 72 hours. Everything else can be built before then.

## Verification
- After the domain is verified, send a test of each email to a real `@wecrew.in` mailbox, then check the delivery log. The mailbox owner needs to confirm receipt.
- Post a staff reply and an internal note on a test ticket. Only the public reply should send an email.

## Note
- The portal dashboard from the previous plan is only partly built: the shared pieces exist, but the separate tabs don't yet. I'll finish it in this work so the "View in portal" links open the right ticket.

## Technical details
- Run `email_domain--scaffold_auth_email_templates`, brand the six auth templates and deploy `auth-email-hook`.
- Run `email_domain--scaffold_transactional_email_templates`. Add these templates:
  - `ticket-reply`
  - `ticket-status-changed`
  - `ticket-received`
- Triggers in server code:
  - The staff comment server function sends `ticket-reply` when `internal=false` and the author is not the requester.
  - Incident and request state-change server functions send `ticket-status-changed`.
  - `submitPortalTicket` and `submitPortalRequest` send `ticket-received` after the RPC succeeds.
- The requester's email is looked up server-side with the admin client. It is never taken from the browser.
- Idempotency keys follow the pattern `<template>-<comment_id|record_id>-<state>`. A `recipient_suppressed` result is a normal outcome and is not retried.
- Portal deep links use `/portal/tickets?record=<id>` and `/portal/requests?record=<id>`.
