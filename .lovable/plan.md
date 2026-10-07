# Customer portal dashboard

## What customers will see
The portal becomes a small home base with four tabs. Each tab has its own web address, so customers can bookmark it or follow a link straight to it.

- **Home.** Shows:
  - Counts for open tickets, open requests, and items waiting on the customer's reply.
  - A "We need your reply" list.
  - The five most recent updates across all their tickets and requests.
  - Quick buttons: "Report an issue", "Request a service" and "Search help".
- **My tickets.** The full history, including resolved and closed tickets.
  - Filters for open, waiting on me, resolved and closed, plus search by number or title.
  - Opening a ticket shows the current detail view, with updates, replies, the target date and known workarounds.
- **My requests.** Every service request the customer has raised. Each one shows:
  - its approval status and progress
  - its target date
  - its public updates
  - a reply box, which uses the same waiting-on-customer rules as tickets
- **Help & services.** Two parts:
  - Search the published knowledge articles by keyword, category or tag, and read them inside the portal. Drafts and archived articles never show.
  - Browse the service catalogue and submit a request. Requests follow the same team, priority, deadline and approval rules as requests raised by staff.
- Only confirmed @wecrew.in accounts can open the portal, as now. Staff-only notes, internal comments and catalogue routing settings stay hidden.

## Verification
- Use a confirmed @wecrew.in test account. Without one, the allowed-customer path is marked unverified. Then:
  - Check that every tab loads and that the counts match.
  - Read a knowledge article.
  - Submit a catalogue request and confirm it gets the expected team, priority and deadline.
  - Reply to a request that is waiting on the customer and confirm its target date moves.
- Check that a Gmail test account is still blocked.

## Technical details
- `src/routes/portal.tsx`:
  - Split into a layout route, `portal.tsx`, that renders `<Outlet />`.
  - Add four leaves: `portal.index.tsx` (Home), `portal.tickets.tsx`, `portal.requests.tsx` and `portal.help.tsx`.
  - Each leaf gets its own `head()`.
  - Selection and filters are stored in the page address as `?record=`, `?status=`, `?q=` and `?article=`.
  - Shared sign-in and domain-gate pieces move to `src/components/portal/`.
- `src/lib/portal.functions.ts`:
  - `getPortal` returns all states and adds request comments, which it already partly does.
  - New `listPortalKnowledge` and `listPortalCatalog`. Each one calls `portal_allowed()` first, then reads published articles and active catalogue items with the admin client, returning only the columns customers need.
  - New `submitPortalRequest`.
- Migration:
  - Add a `portal_submit_request(_catalog_item_id, _title, _description)` security-definer RPC. It checks `portal_allowed()`, applies the existing catalogue routing, approval and SLA logic shared with `itsm_create_service_request`, and uses the same 10-per-hour limit as ticket submission.
  - Grant execute to `authenticated`.
- Keep the existing `portal_reply` and `portal_reply_request` RPCs.
