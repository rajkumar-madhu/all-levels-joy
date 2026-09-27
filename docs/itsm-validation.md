# ITSM verification

## Completed local validation — 28 September 2026

| Check                                            | Result                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test`                                   | PASS — 26 unit/query/schema tests, including all 49 incident state-transition pairs.                                                                          |
| `bunx tsc --noEmit`                              | PASS.                                                                                                                                                         |
| `bun run lint`                                   | PASS — zero errors, 15 existing Fast Refresh warnings.                                                                                                        |
| `bun run build`                                  | PASS — production client/server output generated; bundle-size advisory remains.                                                                               |
| `bun run test:db`                                | PASS — complete migration chain through `0007`, incident lifecycle, membership/privacy, transactional audit, approval rules and real two-session concurrency. |
| `bun run test:ui`                                | PASS — isolated desktop/mobile component behavior, error/empty/loading states, keyboard navigation and focus restoration. Synthetic fixture.                  |
| `bun run test:e2e`                               | PASS — actual application with local Supabase Auth, Postgres, REST and Storage; seven authenticated personas and complete incident/request/change journeys.   |
| `git diff --check`                               | PASS.                                                                                                                                                         |
| Hosted migration / deployment / production smoke | Release-dependent — see the deployment report for the published revision, migration ledger and live checks.                                                   |

## Repeatable commands

Use Bun, matching `bun.lock`:

```sh
bun install
bun run test
bunx tsc --noEmit
bun run lint
bun run build
```

Database regression checks require Docker and `postgres:16-alpine`:

```sh
bun run test:db
```

This suite runs a disposable PostgreSQL container with no network or published ports. It applies all Supabase and Drizzle migrations, uses minimal platform shims for auth/storage, executes all four SQL suites and removes the container. Approval tests use two database connections to prove lock serialization and a single final notification. Failure injection proves audit/notification failures roll back parent records, decisions and earlier evidence writes together.

For the actual authenticated application:

```sh
# One-time browser installation, if Chromium is not already installed
bunx playwright install chromium
# Docker must be running. Ports 56420–56422 and 8082 must be free.
bun run test:e2e
```

The E2E runner starts a separate local Supabase project from a temporary directory, applies all checked-in migrations, creates confirmed local test identities without sending email, and starts the actual Vite application at `127.0.0.1:8082`. The app receives local environment overrides; the repository `.env` is not modified. Browser requests to hosted Supabase domains are rejected. The app process and test stack are removed at completion, including on test failure. Screenshots, a JSON report and application log are retained in the temporary evidence directory printed by the command. No real customer data is used.

Optional `PLAYWRIGHT_CHROMIUM` points at an existing compatible browser. `ITSM_E2E_KEEP=1` retains the test stack for investigation; `ITSM_E2E_STACK_DIR` can reuse only that owned temporary test workspace. These debug options are unnecessary for normal runs. Logs from local stack startup may contain disposable local credentials and are created with owner-only permissions.

## Authenticated browser coverage

- Signed-out visits to protected pages load sign-in without hydration errors and retain the requested route, record and queue parameters after authentication.
- Requester signs in, creates an incident, adds a public note and uploads a file through actual Storage.
- Operator claims and reassigns the incident, progresses through work/pending/resolution/closure/reopening, and preserves/clears the correct resolution metadata.
- Internal notes stay hidden from the requester. A peer cannot read the incident, its comments, attachment metadata or actual stored file. Operators see structured audit evidence; requesters cannot read it.
- Two real browser sessions attempt conflicting edits; stale changes fail without overwriting the newer record.
- Desktop search returns the matching record. The 390px mobile queue and navigation render without horizontal page overflow.
- Requester submits an approval-controlled catalog item. Two independent approvers act through the browser; one vote leaves it pending, both votes permit fulfillment, and a repeated decision is rejected.
- Browser rejection cancels the parent and remaining approval tasks. Later approval cannot revive it.
- Change manager raises a normal change, two CAB members approve it, then implementation, delivery evidence and closure complete through the actual screens.
- Uninvited and deactivated identities see an explicit access error. API checks confirm no records, membership reactivation, self-enrollment or implicit operational-role grants.
- No uncaught browser runtime exceptions or hosted Supabase traffic occur.

## Component-only browser coverage

```sh
# Terminal 1
bun run test:ui:dev
# Terminal 2
bun run test:ui
```

The fixture at `/tests/ui/incident-workbench.html` uses explicitly labeled synthetic data and backend aliases that throw. It verifies shared shell/workbench states, filters, notification popover, mobile focus trapping, Escape and focus restoration. It is excluded from the production application. `ITSM_UI_URL` defaults to `http://127.0.0.1:8081`; `ITSM_UI_ARTIFACTS` defaults to ignored `artifacts/itsm-ui.local`. `PLAYWRIGHT_MODULE` can select an external runtime when needed.

## Evidence boundaries

Local E2E validates the real application with local authentication and database services. It does not establish hosted sign-in, Google OAuth, email delivery, production load, broad accessibility certification or deployment success. Database authorization tests cover multiple tenants/personas; the application still selects a fixed workspace. The assistant, external integrations, problem/major-incident transactions and non-core audit still need deeper end-to-end verification. Existing database seed migrations contain sample operational rows; those are test/sample data, not production telemetry.

Core audit retains structured lifecycle, ownership and approval fields, not copies of free-text descriptions, plans or notes. Historical audit is not backfilled. Other modules and comment/attachment audit remain application-generated. See [rollout notes](./itsm-rollout.md) for migration/data compatibility requirements.
