# Roadmap

- [x] Public service status page: live service health, landing and portal links, public-safe reads; four tests and signed-out desktop/mobile checks passed

- [ ] Sign up info@wecrew.in, accept staff invitation and approve a finding, change and catalogue request (blocked: account does not exist; user must choose a password and confirm their mailbox before invitation acceptance and approvals)

- [x] Staff-only Security workspace: landing links, server staff gate, staff finding inspection and non-staff direct-board rejection; 15 security tests passed
- [ ] Verify Security restriction with an active requester-only workspace member (blocked: available customer test account has no active workspace membership; direct-board rejection verified)
- [ ] Team email notifications (blocked: staff work-email/team assignments and verified sender domain needed)

- [x] Security fix-window timezone conversion; regression tests pass in UTC, New York and Kolkata
- [ ] Confirm saved security window on a real finding (blocked: SEC0001001 is pending independent approval; current staff account cannot approve it)

- [ ] Administration catalogue routing rules with upcoming-request preview (plan prepared; awaiting approval)
- [ ] Obtain and share real IT documentation, replace starter Knowledge articles, and verify public help search (blocked: documentation pages or files needed)

- [ ] Scanner module: signed intake, manual-field parity, scanner activity and end-to-end verification

- [x] Finish ticket response timelines for incidents and requests: opened, assigned, closed and SLA breach details; 12 tests passed, staff preview verified assignment, live breaches and labeled test request resolution/closure

- [x] Knowledge base: categories, tags, 21 starter articles, sample articles retired, assistant grounded with linked citations
- [x] Change register with filters, wired into dashboard and global search
- [x] Linked records panel on incidents (changes + problem)
- [x] Security findings module: findings lifecycle, risk exceptions, workspace wiring
- [x] Nightly exception expiry (02:00 UTC)
- [ ] Scanner signing secret (user declined secure form)
- [x] Portal replies drive ticket status and target dates; request queue panel on dashboard
- [x] Catalogue request + portal sign-up/ticket end-to-end test
- [ ] Assign people to the Service Desk and Platform Operations teams (needs user: who belongs to each team) so reply notifications reach someone
- [ ] Submit Software installation request from catalogue; verify Platform Operations / Low / deadline on Requests page (approved plan)
- [ ] SLA dashboard per team at /sla: open counts, due-soon, breached; linked from dashboard and global search (approved plan)

- [x] Integrations hub: Prometheus/Grafana/webhook alerts create deduplicated incidents; dashboard Connected stack + CMDB; Slack/Teams critical notifications
- [ ] Configure MONITORING_WEBHOOK_TOKEN (and optional SLACK_WEBHOOK_URL / TEAMS_WEBHOOK_URL) and point Alertmanager/Grafana at /api/public/alerts (needs user)
- [ ] Jira/GitHub/Linear two-way sync (planned)
- [ ] Post critical alerts to Slack via incoming webhook (SLACK_WEBHOOK_URL; needs user to paste real URL in secure form)
- [x] Hardened alert webhook (filter-safe lookups, exact dedupe, 25/request + 20 per 10 min, http(s) links only, uniform 401, min token length)
