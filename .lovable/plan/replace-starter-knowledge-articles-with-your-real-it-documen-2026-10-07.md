# Replace starter Knowledge articles with your real IT documentation

## What you'll get
- **The preview works again.** First I'll fix the error on the customer portal page that is stopping the preview from loading.
- **Your real IT pages, imported as Knowledge articles.** By default I'll read them from your connected Notion workspace. If they live somewhere else, you can upload files, paste text or send links instead. Each page becomes a published article with:
  - its title
  - a short summary
  - the full steps
  - one of the eight categories
  - a few tags
- **The 21 starter articles are archived.** They disappear from search and from the assistant, but your team can still restore them. Their made-up details, such as the VPN address and Wi-Fi name, go with them.
- **Assistant check.** For three of your imported pages, I'll ask the Support assistant a matching question. Each answer should cite that page and link to it. I'll also ask one unrelated question. The assistant should say it has no matching article and offer to raise a ticket.

## What I need from you
- Your documentation pages, or a confirmation that they're in Notion and which pages or folder to use. Nothing can be imported until I have them.

## Technical details
- Fix the `src/routes/portal.tsx` disallowed-access return shape, then check the build log.
- Read the source through the Notion connector (search plus fetch), or through uploaded or pasted content. Map each page to a `knowledge_articles` row. Insert the rows with the data tool, numbered from the existing KB counter, with `status='published'`, `published_at=now()` and a `tags` array.
- Set the current 21 starter articles to `status='archived'` with a data update. This needs no schema change.
- The assistant ranking and citation code in `src/lib/assistant.functions.ts` stays as it is. Model: `openai/gpt-6-astra`.
- Verify in Playwright, signed in as the staff test account: open the Knowledge list, test tag search, then run the assistant questions.
