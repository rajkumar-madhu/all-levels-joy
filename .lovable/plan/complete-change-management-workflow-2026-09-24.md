# Complete change management workflow

## Change request and assessment

- Expand the change request with business justification, impact assessment, expected outage, affected configuration items, implementation owner, validation plan, rollback trigger, and communication plan.
- Keep standard, normal, and emergency paths distinct: standard changes can use a pre-approved path, normal changes require CAB approval, and emergency changes require expedited approval.
- Validate that the schedule ends after it starts and that implementation, testing, rollback, and impact details are complete before submission.

## Approval and governance

- Show CAB reviewers the risk, impact, schedule, implementation, testing, and rollback details directly in the approval queue.
- Require decision notes when rejecting a change.
- Keep a change pending until every assigned CAB reviewer approves; any rejection cancels it.
- Record approval progress and decisions on the change record and in its audit trail.

## Schedule and delivery

- Give change managers a guided lifecycle: pending approval → approved/scheduled → implementation in progress → delivered → closed, with cancellation available before closure.
- Prevent implementation before approval and prevent delivery before the scheduled window starts.
- Capture delivery outcome, actual start/end times, validation results, whether rollback was used, and post-implementation review notes.
- Surface schedule status, approval progress, delivery status, affected service/assets, and all plans in the change detail view.

## Workspace integration

- Add change workflow metrics and actionable queues for pending approval, upcoming scheduled work, active implementations, and overdue reviews.
- Keep global search and dashboard links opening the exact change record.
- Refresh workspace, approval, activity, and dashboard data after every workflow action.

## Data and security

- Add only the fields needed for assessment, scheduling, and delivery to the existing change records, with safe defaults for current data.
- Preserve organization-scoped access and enforce change-manager/CAB permissions on the server for every transition.
- Keep a complete audit history of submission, approval, scheduling, implementation, rollback, delivery, and closure.

## Verification

- Verify normal, standard, and emergency request paths.
- Verify multi-reviewer approval behavior, rejection behavior, schedule gates, delivery evidence, and direct links.
- Check desktop and compact layouts, type safety, build status, browser errors, and the end-to-end workflow with a test account.
