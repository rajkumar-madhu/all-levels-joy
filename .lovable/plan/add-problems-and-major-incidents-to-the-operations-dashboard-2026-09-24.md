# Add problems and major incidents to the operations dashboard

## Dashboard metrics

- Load the existing problem board and major-incident command data alongside the workspace summary.
- Add metrics for active problems and active major-incident bridges.
- Make both metrics actionable links to their full management pages.
- Keep the current incident, SLA, request, approval, and change metrics intact while adjusting the grid for the additional cards.

## Operational queues

- Add an **Active major incidents** queue prioritized by severity and escalation level, showing bridge number, source incident, bridge state, severity, escalation level, latest situation summary, and whether the next update is overdue.
- Add an **Open problem investigations** queue prioritized by problem priority and recency, showing problem number, state, priority, known-error status, linked-incident count, and title.
- Link each row to the relevant Problems or Major incident command page and keep the existing incident and change queues available.
- Include clear loading, empty, and error states so dashboard access remains reliable if either supporting feed is temporarily unavailable.

## Supporting navigation

- Add URL-based record selection to Problems and Major incident command so dashboard queue links open the exact problem or bridge rather than only the page.
- Preserve each page’s current fallback behavior when no record is selected.

## Verification

- Confirm counts match the active records returned by the existing problem and command-center services.
- Open a problem and major-incident bridge from the dashboard and verify the exact record is selected.
- Check the dashboard at desktop and compact widths, then confirm a clean build and browser console.
