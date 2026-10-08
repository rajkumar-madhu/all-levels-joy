# Public knowledge search on the customer portal

Let customers search and read published help articles on the portal landing page (`/portal`) without signing in.

## What customers will see

- The signed-out portal page gains a "Find an answer" section above the sign-in box:
  - A search box that matches article titles, categories and tags as you type.
  - Category chips to browse by topic (Account & sign-in, Network, Email, etc.).
  - A list of matching published articles; clicking one opens the full article on the portal (no sign-in needed).
  - A "Still stuck? Sign in to raise a ticket" prompt under the results, so the portal sign-in stays one click away.
- Signed-in customers keep the existing ticket view; the knowledge search stays available to them too.

## How it works

- **Public read access, safely:** today only staff can read knowledge articles. A database change will allow anonymous read of **published** articles only — retired/draft articles, internal tickets and all other workspace data stay staff-only. No customer data is exposed.
- A public search function returns only published articles (id, title, summary, category, tags, body) for the support organisation, with the search text validated and length-limited.
- The portal page shows the knowledge section whether or not the visitor is signed in; article content renders read-only with the same styling as the staff knowledge reader.
- Page metadata updated so the portal describes the self-service help search.

## Verification

- Typecheck, then a preview test: open `/portal` signed out, search "VPN" and "MFA", open an article, confirm retired articles and tickets never appear, and confirm the sign-in box still works.
