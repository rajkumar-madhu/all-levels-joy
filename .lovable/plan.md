# Timezone-safe security fix windows

## Confirmed issue
The Security page sends timezone-free values from its start/end fields. The server converts them using its own timezone rather than the person’s timezone, shifting the saved window and potentially the earliest permitted remediation start.

## Fix
- Convert both selected local times into timezone-aware UTC timestamps in the browser before saving.
- Require explicit timezone information on the server; reject ambiguous or invalid timestamps rather than guessing.
- Validate that the end is later than the start, with clear messages for missing or invalid selections.
- Display saved windows in the browser’s local timezone and show which timezone the selection uses.
- Preserve existing approval, authorization and remediation-start safeguards.
- Leave previously saved windows unchanged: their intended times cannot safely be inferred.

## Technical details
- Update scheduling in `src/routes/_authenticated/security.tsx`, schedule validation in `src/lib/security-workflow.ts`, and timestamp handling in `src/lib/security.functions.ts`.
- Add a focused local-time conversion helper with regression tests. Reject nonexistent local times during daylight-saving transitions instead of silently shifting them.
- No database schema change or lifecycle bypass is needed.

## Verification
- Test both start and end: New York 14:00 on October 5, 2026 becomes 18:00 UTC and displays back as 14:00; Kolkata 14:00 becomes 08:30 UTC and displays back as 14:00.
- Cover timezone-free server inputs, invalid dates, end-before-start, and daylight-saving behavior.
- Sign in as authorized staff and use a real approved finding, preferably a labelled test finding. If none is available, create a test finding and follow the normal independent approval flow; never bypass approval.
- Save a future window in a non-UTC browser timezone, reload the finding, and confirm both displayed times match the selections and stored timestamps represent the same instants.
- Confirm Start remediation remains blocked before that window opens; do not start real remediation merely to test the fix.
- Report the finding number and selected versus saved times. If independent approval is unavailable, report that specific verification blocker.
- Run relevant tests and check the preview for errors before reporting completion.