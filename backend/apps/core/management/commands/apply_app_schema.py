"""Apply SQL owned by this backend (new features, not part of the legacy app) after the legacy schema.

Files are numbered `apps/<app>/sql/NNNN_<name>.sql`, applied in (app, file) order and recorded in
`app.app_migrations`. They may reference legacy objects (organizations, can_manage(), ...), which is why
they run after `apply_legacy_schema` instead of as Django migrations. Unnumbered files (core's
platform_compat.sql, which a Django migration applies) are not picked up.
"""

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, transaction


def app_schema_files() -> list[tuple[str, Path]]:
    apps_dir = Path(settings.BASE_DIR) / "apps"
    return [(f"{p.parent.parent.name}/{p.name}", p) for p in sorted(apps_dir.glob("*/sql/[0-9]*.sql"))]


class Command(BaseCommand):
    help = "Apply backend-owned SQL files that have not been applied yet."

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS app.app_migrations (name text PRIMARY KEY, "
                "applied_at timestamptz NOT NULL DEFAULT now())"
            )
            cursor.execute("SELECT name FROM app.app_migrations")
            done = {row[0] for row in cursor.fetchall()}
        pending = [(name, path) for name, path in app_schema_files() if name not in done]
        for name, path in pending:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(path.read_text())
                cursor.execute("INSERT INTO app.app_migrations(name) VALUES (%s)", [name])
            self.stdout.write(f"applied {name}")
        self.stdout.write(self.style.SUCCESS(f"{len(pending)} pending"))
