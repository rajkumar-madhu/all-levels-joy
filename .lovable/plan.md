# Administration routing rules

## What you’ll get
- A **Routing rules** view in Administration, with a direct link using `/administration?tab=routing`.
- A searchable catalogue list with each item's saved default team and priority.
- Team and priority selectors for the selected item, with **Save** and **Discard changes** controls and clear saving/error states.
- A live **Upcoming request** preview that updates immediately as you edit, without creating a ticket.

## Preview behavior
- Mirror the Requests page's columns: request number, title, priority, team, state, and deadline.
- Clearly mark the row as a preview, not an existing request; do not allocate a real ticket number.
- Show the selected catalogue item's name, draft team and priority, initial request state, and an estimated deadline based on the existing delivery rules.
- Show approval requirements when applicable. Saving affects future submissions only; existing requests, assignments and deadlines stay unchanged.
- Provide an **Open Requests** link for checking the actual queue.

## Implementation
- Add the view to the existing admin-only Administration tabs and preserve the current members, invitations, teams and settings views.
- Reuse the catalogue defaults and existing routing save operation already used on the Service catalogue page. Preserve that page's current access and functionality.
- Use active assignment teams and the existing request priorities: Critical, High, Moderate and Low; retain the existing unassigned option.
- Refresh catalogue references after a successful save so subsequent submissions use the saved values. Warn before switching items with unsaved changes.
- Keep the existing design and Requests formatting consistent rather than introducing a separate preview design.

## Technical details
- Keep the routing editor and preview in focused components; share Requests row formatting and request priority labels where needed.
- Validate the current save path, workspace scoping and database access before relying on it; do not assume policies from source files alone.
- Confirm the current server-side deadline calculation and initial approval/state behavior before implementing the preview calculation.
- Do not change approval rules, SLA rules, incident-category routing or existing manager routing permissions.
- Add appropriate page metadata for the Administration routing view and record any new structural conventions in `AGENTS.md`.

## Verification
- Test draft team/priority selection, discard behavior and deadline estimation against the existing request rules.
- Sign in as an authorized administrator, change a catalogue rule, save it, reload and confirm it persists.
- Confirm the preview updates before saving and creates no request.
- Confirm a non-admin cannot access the Administration routing view.
- Submit one clearly labelled test request using the saved rule and verify its team, priority and deadline on Requests; restore the original catalogue defaults afterward.
- Check the view at narrow and wide widths, run relevant tests, and confirm the preview has no errors.