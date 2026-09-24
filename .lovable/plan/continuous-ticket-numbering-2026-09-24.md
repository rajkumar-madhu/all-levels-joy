# Continuous ticket numbering

Today each new ticket number is worked out by counting existing rows and adding 1001, so numbering restarts near the bottom of the range instead of carrying on from the existing records. The three original incidents are INC0012839, INC0012845 and INC0012847, while the two tickets raised since are INC0001004 and INC0001005. The same counting rule is used for requests, changes, knowledge articles, problems and major incidents, and the chatbot has its own copy of it.

## What will change

- Every record type gets a proper counter in the database that only ever moves forward. New tickets continue the existing series: the next incident becomes INC0012848, the next change CHG0004183, the next article KB001094, and so on. Requests, problems and major incidents keep their current starting points.
- Two numbers can never be handed out twice, even if two people submit at the same moment, and deleting a record no longer pulls the next number backwards.
- The two off-sequence incidents raised during testing (INC0001004 and INC0001005) are renumbered into the main series so the list reads consistently. Their history, comments and attachments stay attached — only the visible reference changes. If you would rather leave them as they are, say so and I will skip that step.
- Everywhere numbers are shown (lists, detail panels, search, the assistant's ticket confirmation) keeps working exactly as now.

## Technical notes

- Migration: create a `record_counters` table keyed by organization and prefix, plus a `SECURITY DEFINER` function `next_record_number(_org_id uuid, _prefix text)` that atomically increments and returns the padded number. Seed each counter from the current maximum numeric suffix per series (incidents 12847, changes 4182, knowledge 1093, others at their current max or 1000 baseline). Grant execute to `authenticated` and `service_role`; revoke from `public`/`anon`.
- Replace the count-based `nextNumber` helpers in `src/lib/itsm.functions.ts` and `src/lib/problem.functions.ts`, and the inline copy in `src/lib/assistant.functions.ts`, with a single shared helper that calls the RPC and preserves each prefix's existing digit width (INC/REQ/CHG/PRB/MI = 7 digits, KB = 6).
- Renumber the two stray incidents with a data query (run_sql), updating only `incidents.number`, then bump the incident counter accordingly. Row ids are untouched, so audit events, attachments, comments, problem links and the major-incident link all remain intact.
- Verify with a typecheck plus a Playwright pass: create an incident from the UI, create one through the assistant, and confirm both land on sequential numbers after INC0012847.
