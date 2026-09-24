# Searchable knowledge base

The workspace already has a Knowledge page with article authoring, a two-column article list and reader, and the global search already returns knowledge matches. The missing connection is that selecting a knowledge result opens only the page, not the matched article. Search on the Knowledge page itself is also not available yet.

## Experience

- Turn Knowledge into a reader-first knowledge base while preserving the existing author workflow for permitted staff.
- Add a prominent search field that searches article number, title, summary, category and article content.
- Add category and publication-status filters, a result count, and clear empty states. Ordinary users will see published material; authors can also find their drafts, reviews and retired articles.
- Show searchable article results as a compact, scannable list with number, title, summary, category, status and last-updated date.
- Open a selected article in the reading pane and keep the selected article in the URL, so links can be copied, refreshed and reopened reliably.
- Keep the existing New article and Edit actions, with the filtered list refreshing after a save.

## Global search connection

- Change knowledge results in the workspace-wide search so clicking one navigates to Knowledge with that exact article selected.
- Expand workspace-wide knowledge matching beyond number/title to include summary, category and article content, while retaining the current five-result limit.
- Preserve the search query when entering Knowledge from a general “view knowledge results” path where appropriate.

## Technical details

- Add validated `record`, `q`, `category` and `status` search parameters to the Knowledge route using TanStack Router’s Zod adapter and `fallback()` defaults.
- Derive the filtered list from existing knowledge data and synchronize article selection through typed navigation instead of local-only state.
- Update the authenticated `searchRecords` function’s knowledge query to search all relevant article fields.
- Update `GlobalSearch` to pass the selected knowledge article id in the `record` search parameter.
- No schema change is needed: the existing knowledge records already contain number, title, summary, content, category, status and update timestamps.

## Verification

- Check direct search by article title, number, category and body text.
- Check category/status filters and no-result/reset behavior.
- Select a knowledge result from global search and confirm the matching article opens after navigation and browser refresh.
- Confirm author creation/editing still works, then verify the final build and browser console are clean.
