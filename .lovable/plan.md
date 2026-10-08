# Public knowledge search, staff editing check, and Administration fix

Three pieces of work, verified together in the preview with a staff sign-in.

## 1. Public knowledge search on the portal landing page

Customers can search and read published help articles on `/portal` without signing in.

- The signed-out portal page gains a "Find an answer" section above the sign-in box:
  - Search box matching article titles, categories and tags as you type.
  - Category chips to browse by topic.
  - Matching published articles listed; clicking one opens the full article read-only on the portal.
  - A "Still stuck? Sign in to raise a ticket" prompt keeps sign-in one click away.
- Signed-in customers keep the existing ticket view; the knowledge search stays available to them too.
- **Safe public read access:** today only staff can read knowledge articles. A database change will allow anonymous read of **published** articles only — drafts, retired articles, tickets and all other workspace data stay staff-only. A public search function returns only published articles with validated, length-limited search text.
- Portal page metadata updated to describe the self-service help search.

## 2. Confirm staff can edit tickets

After the recent role-security changes (staff-only internal ticket editing), sign in as a staff account in the preview and confirm:

- Opening an incident, changing its state/priority/assignment and saving works.
- A non-staff path (catalogue, assistant, portal) still creates tickets but cannot edit them.

If staff editing is blocked, fix the permission so the intended roles (service desk, fulfiller, manager, admin) can edit.

## 3. Fix the Administration page

The Administration page fails to load after the security changes. Steps:

- Reproduce the failure signed in as an admin in the preview and capture the exact error.
- Most likely cause: the page's data function (`itsm_admin_overview`) lost its execute permission or a policy change blocks it. Restore the permission/policy so admins load the page, while non-admins stay blocked.
- Confirm the page loads: members, teams and invitations all render, and inviting someone still works.

## 4. Staff-only portal (already built — verify)

The signed-in workspace is the staff portal: incidents, problems, changes, requests, knowledge and administration are all staff-only behind sign-in, and the landing page links to it. This plan adds a verification pass: landing page sign-in link works, signed-out visitors are redirected to sign-in, and staff can open and manage tickets, problems and changes.

## 5. Replace starter Knowledge articles with real IT documentation (blocked)

The connected Notion contains no IT help pages (only to-do lists, project notes and network queries). This task is blocked until you provide the real documentation — a Notion page/folder shared with the connection, attached files, pasted text, or web links. Once provided: import the pages as articles, retire the starter set, and verify the Support Assistant answers from them with citations.

## Verification

- Typecheck, then preview tests: signed-out knowledge search ("VPN", "MFA") with no retired articles or tickets leaking; staff incident edit; Administration page load as admin.
