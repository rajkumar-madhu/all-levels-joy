# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WeCrew ITSM — an enterprise IT service management app (incidents, service requests, changes/CAB, problems, major incident command, knowledge base, CMDB) built on TanStack Start and Supabase. Scaffolded and synced via [Lovable](https://lovable.dev); see `AGENTS.md` for the Lovable sync warning (never force-push, rebase, or amend/squash pushed commits on the connected branch).

## Commands

- `npm run dev` — start the Vite dev server (TanStack Start SSR)
- `npm run build` — production build (nitro/vite)
- `npm run build:dev` — development-mode build
- `npm run preview` — preview a production build
- `npm run lint` — ESLint over the whole repo
- `npm run format` — Prettier write

There is no test suite configured in this repo. The lockfile present is `bun.lock` (bun is the intended package manager despite the README's `npm i` instructions), but scripts are invoked as plain npm scripts.

## Architecture

### Stack
TanStack Start (file-based router + SSR) + React 19 + Supabase (Postgres, Auth) + Tailwind v4 + shadcn/ui (`new-york` style) + Vercel AI SDK (`ai`, `@ai-sdk/openai`) routed through Lovable's AI Gateway.

### Routing (`src/routes/`)
File-based routing via `@tanstack/react-router` — see `src/routes/README.md` for the exact file-naming conventions (`$id`, `{-$optional}`, `$.` splat, `_layout`, `__root`). Never hand-edit `src/routeTree.gen.ts` (auto-generated). Every authenticated page lives under `src/routes/_authenticated/`, whose `route.tsx` gates access in `beforeLoad` by checking `supabase.auth.getUser()` and redirecting to `/auth` otherwise — that layout has `ssr: false`, so authenticated pages render client-side.

`src/routes/__root.tsx` is the single app shell: sets page `<head>` metadata, wraps everything in `QueryClientProvider`, listens for Supabase auth-state changes to invalidate the router/query cache, and renders the global error/not-found boundaries (which report to Lovable's runtime error hook via `src/lib/lovable-error-reporting.ts`).

### Server functions are the entire backend
There are no API route handlers — all reads/writes go through TanStack Start `createServerFn` functions colocated in `src/lib/*.functions.ts`:
- `itsm.functions.ts` — workspace bootstrap, incidents, service requests, changes/CAB approvals, knowledge articles, CMDB, attachments, search, incident metrics
- `problem.functions.ts` — problems, problem↔incident linking, major incident command (bridge state, comms updates)
- `assistant.functions.ts` — AI chat threads/messages, streams a ticket suggestion from the model and creates the incident only after explicit user confirmation

Every server fn is wrapped with `.middleware([requireSupabaseAuth])` (see `src/integrations/supabase/auth-middleware.ts`), which validates the bearer JWT from the request and injects `{ supabase, userId, claims }` into `context`. The client attaches that bearer token automatically via the `attachSupabaseAuth` client middleware registered globally in `src/start.ts` — don't call server fns without that plumbing in place. Inputs are always validated with a Zod `.validator()` before the handler runs.

All fns use `DEMO_ORG_ID` from `src/lib/itsm-shared.ts` as a single hardcoded organization — this is a single-tenant demo workspace, not a real multi-org boundary.

### Supabase client tiers — pick the right one
- `src/integrations/supabase/client.ts` — browser/RSC client, respects RLS, session-persisting. Import as `import { supabase } from "@/integrations/supabase/client"`.
- `src/integrations/supabase/client.server.ts` — service-role client that **bypasses RLS**. Only import this inside server handlers via dynamic `await import(...)` (as the existing `*.functions.ts` files do), never as a top-level import in a route file or a `*.functions.ts` module, since those ship to the client bundle.
- `src/integrations/supabase/auth-middleware.ts` — per-request RLS-scoped client built from the caller's JWT; this is what `context.supabase` is inside a server fn.

`src/integrations/supabase/types.ts` is the generated `Database` type — regenerate it from Supabase rather than hand-editing when the schema changes. `drizzle/schema.ts` is intentionally blank (not the source of truth); actual schema changes ship as SQL files under `supabase/migrations/`.

### Role model
Roles (`AppRole` in `itsm-shared.ts`): `requester`, `service_desk`, `fulfiller`, `change_manager`, `cab_member`, `cmdb_manager`, `manager`, `admin`. `bootstrapWorkspace` auto-grants the full role set to the very first user in an org (bootstrap admin) and only `requester`/`service_desk` to everyone after. Server fns gate mutations with `requireRoles(roles, [...])` / `canManage()` / `canRunProblems()` — always add the equivalent role check when adding a new mutating server fn, mirroring the pattern in `itsm.functions.ts` and `problem.functions.ts`.

### Record lifecycle conventions
- Record numbers (`INC-…`, `REQ-…`, `CHG-…`, `KB-…`, `PRB-…`, `MI-…`) come from the Postgres RPC `next_record_number` via `src/lib/record-number.ts` — never synthesize numbers client-side.
- Every mutation writes an `audit_events` row via each file's local `writeAudit()` helper — follow this pattern for new mutations so the audit trail (`/audit` route) stays complete.
- State machines (incident/request/change/problem state, change approval flow, major-incident bridge state) enforce their transition rules inside the server fn handler (e.g. a change can't `close` without `pir_notes`/`validation_results`; resolving/closing an incident requires resolution notes) — extend these rules in the handler, not in the UI.

### AI assistant
`assistant.functions.ts` calls Lovable's AI Gateway (`https://ai.gateway.lovable.dev/v1`) via the OpenAI-compatible provider from `ai`/`@ai-sdk/openai`, requires `LOVABLE_API_KEY`, and grounds responses in published `knowledge_articles`. It returns a structured `{ reply, needsTicket, ticket... }` object; the UI must let the user confirm before `createTicketFromChat` actually creates an incident — the assistant must never silently create tickets.

### Error handling
`src/lib/error-capture.ts` monkey-patches `console.error` to expand `Error`/cause chains (h3 swallows thrown errors into an opaque 500 JSON body with no stack) and stashes the last error for `src/server.ts` to recover when re-rendering a proper error page. `src/start.ts` defines global request/function middleware (`errorMiddleware`, CSRF middleware) — keep `src/start.ts` present, since removing it silently disables TanStack Start's default CSRF protection for server functions.

### Data fetching
Client-side, server fns are called through TanStack Query via the `queryOptions()` factories in `src/lib/workspace-queries.ts` (`workspaceQuery`, `referenceQuery`, `activityQuery`, `incidentMetricsQuery`, `problemBoardQuery`, `commandCenterQuery`). `useWorkspace()` in `src/components/app-shell.tsx` bootstraps the workspace then feeds `workspaceQuery()`; most authenticated routes call `useWorkspace()` plus `useQuery(referenceQuery())` for lookups (services, groups, catalog, knowledge, CMDB, people).

### Path aliases & UI kit
`@/*` maps to `src/*` (see `tsconfig.json`). `src/components/ui/*` is shadcn/ui (`new-york` style, Tailwind v4, `cn()` helper in `src/lib/utils.ts`) — regenerate/add components with the shadcn CLI using the aliases in `components.json` rather than hand-rolling primitives.
