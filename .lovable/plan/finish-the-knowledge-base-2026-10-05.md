# Finish the knowledge base

## What you'll get
- **Categories you manage.** A fixed list: Access & accounts, Network & VPN, Email & collaboration, Hardware & devices, Software & apps, Printing, Security, Onboarding. Each has a short description. Staff with management roles can add, rename or retire categories from the Knowledge page.
- **Tags on every article**, for example "mfa", "outlook" or "macos". Tags show as chips. You can filter by them and search finds them. Authors add tags in the article editor.
- **A starter set of about 20 IT help articles**, written as practical step-by-step guides. Topics include:
  - Resetting a password, setting up MFA, and getting back in when MFA is locked out.
  - Connecting to VPN, fixing VPN drops, and Wi-Fi on a new office floor.
  - Shared mailboxes, Outlook search not working, and setting up Teams or Slack.
  - Requesting a new laptop, a slow laptop, and pairing a docking station.
  - Installing approved software and getting access to an application.
  - Adding a printer and clearing stuck print jobs.
  - Reporting phishing, a lost or stolen device, and encrypting a USB drive.
  - A new starter's first-day checklist.

  They're published so the Support assistant can use them straight away. Your team can edit or unpublish any of them.
- **The 2 sample articles are retired.** They're archived, so they leave search and the assistant.
- **The Support assistant answers from these articles.** It favours articles whose category and tags match the question. It cites article numbers as links that open the article. If no article fits, it says so and offers to raise a ticket. Drafts and archived articles are never used.

## Verification
- The Knowledge page lists the new articles by category, and filtering by tag works.
- Global search finds articles by a tag.
- Ask the assistant "My VPN keeps dropping" and "How do I set up MFA on a new phone". Each answer should cite the matching article. Ask an unrelated question and check it admits there's no article and offers a ticket.

## Technical details
- Migration:
  - New `knowledge_categories` table (organization-scoped; name, slug, description, active, sort order). Staff can read it and `can_manage` users can write it, with grants and RLS set up.
  - New `knowledge_articles.tags text[] default '{}'` column with a GIN index.
  - Turn the existing `category` text values into rows in the new table. Keep the `category` column as the article's link, matched by name, so no breaking change.
- Seed: about 20 articles inserted through the database tool, numbered by `next_record_number('KB')` semantics. Use the existing KB counter so numbers continue. Set the 2 sample articles to `status='archived'`.
- UI in `src/routes/_authenticated/knowledge.tsx`:
  - Category manager and tag chips.
  - Tag filter in URL search params.
  - A tag input in the editor.
- `searchRecords` also matches the `tags` array.
- `src/lib/assistant.functions.ts`:
  - Ranking adds a category and tag match boost.
  - The prompt grounding includes the category and tags.
  - Citations become links to `/knowledge?record=`.
  - Keep model `openai/gpt-6-astra` and the existing gateway setup.
