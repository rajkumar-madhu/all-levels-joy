# WeCrew ITSM production foundation

## Goal
Build a secure, full-stack ITSM application inspired by familiar ServiceNow workspaces and record flows, without copying ServiceNow branding or connecting to it. The uploaded WeCrew architecture document will guide terminology, personas, governance, and acceptance criteria.

## First release
- Public sign-in, registration, email confirmation, forgot/reset password, and Google sign-in.
- Full user profiles with display name, avatar, contact details, department, organization, locale, timezone, preferences, and status.
- Role-aware workspaces for requester, service desk, fulfiller/engineer, change manager/CAB, CMDB owner, manager, and administrator.
- A dense operations dashboard with actionable KPIs, assigned work, SLA risk, pending approvals, recent activity, and drill-downs.
- Incidents: intake, impact/urgency priority, assignment groups, comments, timeline, SLA tracking, escalation, related CIs, and resolution.
- Service requests: searchable catalog, request forms, approvals, fulfillment tasks, requester history, and closure.
- Changes: standard/normal/emergency types, risk, plans, maintenance windows, CAB approvals, rollback, evidence, and post-implementation review.
- Knowledge: searchable articles, drafts, review/publish lifecycle, feedback, links to records, and version history.
- Assets and CMDB: configuration items, ownership, lifecycle, services, typed relationships, and linked incident/change history.
- Shared operational features: notifications center, global search, attachments, comments, activity history, filters, pagination, and responsive essential actions.

## Security and data foundation
- Enable Lovable Cloud for authentication, persistent data, and file storage.
- Use organization-aware data ownership and server-enforced access controls; the active organization remains visible throughout the app.
- Keep roles in a dedicated role table, with server-side authorization for every protected read, write, approval, and administrative action.
- Add immutable audit events for record creation, state changes, assignments, approvals, priority/risk changes, closures, and sensitive administration.
- Store profile avatars and record evidence securely, with restricted access and file metadata.
- Configure email/password and Google authentication, leaked-password protection, and current-password verification for signed-in password changes.

## Experience direction
- Create an enterprise operations workspace: compact left navigation, global search, queue-first tables, restrained light surfaces, clear status badges, and context-rich record pages.
- Follow the uploaded task-first record standard: header and primary actions, main working area, context panel, timeline, and audit evidence.
- Make priority, SLA, and risk understandable without color alone; support keyboard navigation, readable focus states, and practical mobile views.
- Include realistic seeded demo records so every dashboard and workflow is inspectable immediately after sign-in.

## Data and workflow model
- Organizations, memberships, profiles, groups, roles, and role assignments.
- Services, catalog items, incidents, requests, request tasks, changes, approvals, knowledge articles/versions, assets/CIs, CI relationships, comments, attachments, notifications, SLA definitions/instances, and audit events.
- Explicit state-transition rules and permissions for each record type; derived priority, SLA state, approval state, and dashboard metrics are calculated consistently.
- Initial workflows cover create, triage, assign, update, approve/reject, resolve/close, reopen where allowed, and link related records.

## Technical implementation
- Use protected TanStack routes for signed-in workspaces and server functions for authenticated business operations.
- Use query-backed loaders and mutations with cache invalidation, validation, useful empty/error states, and no client-trusted authorization.
- Add database migrations with grants, row-level access policies, indexes, triggers, storage rules, literal demo data, and generated types.
- Keep privileged operations server-only and validate all inputs before database access.

## Validation
- Verify sign-up, confirmation handling, both sign-in methods, password recovery, sign-out, and protected-route behavior.
- Test each core journey by role, including denied direct access and cross-organization isolation.
- Confirm audit creation and KPI drill-down consistency.
- Check desktop and mobile layouts, keyboard access, loading/empty/error states, and current preview build health.

## Deliberate boundaries
- ServiceNow is a usability benchmark only; no live synchronization or copied branding.
- External monitoring, messaging, CI/CD, discovery, and automation connectors are represented by integration-ready records and interfaces, not connected in this release.
- Advanced problem management, major-incident command, custom workflow designer, billing, and production disaster-recovery infrastructure remain follow-on phases.
