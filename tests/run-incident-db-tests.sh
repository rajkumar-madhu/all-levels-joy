#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
container_name="itsm-incident-tests-$$"
image="postgres:16-alpine"
docker image inspect "$image" >/dev/null
docker run --rm --detach --network none --name "$container_name" \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
trap 'docker rm --force "$container_name" >/dev/null 2>&1 || true' EXIT

for attempt in {1..30}; do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres >/dev/null

run_sql() {
  docker exec -i "$container_name" psql -X -q -U postgres -v ON_ERROR_STOP=1 < "$1"
}
run_sql "$project_root/tests/sql/platform-shims.sql"
for migration in "$project_root"/supabase/migrations/*.sql "$project_root"/drizzle/migrations/*.sql; do
  run_sql "$migration"
done
run_sql "$project_root/tests/sql/incident-workflow.sql"
run_sql "$project_root/tests/sql/workspace-access.sql"
run_sql "$project_root/tests/sql/transactional-audit.sql"
run_sql "$project_root/tests/sql/approval-workflow.sql"
run_sql "$project_root/tests/sql/workspace-administration.sql"
run_sql "$project_root/tests/sql/administration-assignment.sql"
