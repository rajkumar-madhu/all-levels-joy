# Full Stack Spark

fullstaxt

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cbb4ee71-8a85-4a8a-abca-350f15b8c3d4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## ITSM implementation and verification

This checkout also includes `bun.lock`; the validated local workflow uses Bun.

```sh
bun install
bun run dev
bun run test
bunx tsc --noEmit
bun run lint
bun run build
```

## Replatforming (in progress)

`frontend/` (React + Vite SPA with React Router, Zustand and TanStack Query) and `backend/` (Django REST
Framework with Keycloak sign-in, OPA policies, Celery and Redis) are the new stack. They run beside this app
on the same PostgreSQL schema: incidents, knowledge, the security board and the monitoring, PagerDuty and
scanner webhooks are implemented so far. See [backend/README.md](backend/README.md) and
[frontend/README.md](frontend/README.md). The existing app in `src/` is unchanged.

See the [product comparison and gap analysis](docs/itsm-product-gap-analysis.md), [workspace design system](docs/itsm-design-system.md), and [database/browser validation instructions](docs/itsm-validation.md). Incident workflows, the enterprise workspace UI, active-membership access, requester privacy, atomic approvals and transactional core audit are implemented locally. `bun run test:db` runs the database regression suite; `bun run test:e2e` starts a disposable local Supabase stack and tests authenticated browser workflows. See the report for remaining product gaps and rollout prerequisites.
