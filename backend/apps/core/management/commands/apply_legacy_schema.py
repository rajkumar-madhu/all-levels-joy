"""Apply the legacy Supabase + Drizzle migrations to a plain PostgreSQL database.

Order matches the hosted project: every file in `supabase/migrations`, then the Drizzle files listed
in `drizzle/migrations/meta/_journal.json` (files missing from the journal are not applied, matching
the Drizzle runner). Applied names are recorded in `app.legacy_migrations`.

For a database restored from a Supabase dump, run once with `--mark-applied` to record the
existing chain without executing it.
"""

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction


def legacy_migration_files(root: Path) -> list[tuple[str, Path]]:
    supabase_dir = root / "supabase" / "migrations"
    drizzle_dir = root / "drizzle" / "migrations"
    journal = drizzle_dir / "meta" / "_journal.json"
    if not supabase_dir.is_dir() or not journal.is_file():
        raise CommandError(f"Legacy SQL not found under {root}. Set LEGACY_SQL_ROOT to the repository root.")
    files = [(f"supabase/{p.name}", p) for p in sorted(supabase_dir.glob("*.sql"))]
    for entry in json.loads(journal.read_text())["entries"]:
        path = drizzle_dir / f"{entry['tag']}.sql"
        if not path.is_file():
            raise CommandError(f"Journal lists {path.name} but the file is missing")
        files.append((f"drizzle/{path.name}", path))
    return files


class Command(BaseCommand):
    help = "Apply legacy Supabase/Drizzle SQL migrations that have not been applied yet."

    def add_arguments(self, parser):
        parser.add_argument("--root", type=Path, default=None, help="Repository root (default LEGACY_SQL_ROOT)")
        parser.add_argument("--mark-applied", action="store_true", help="Record without executing")

    def handle(self, *args, root: Path | None, mark_applied: bool, **options):
        files = legacy_migration_files(root or settings.LEGACY_SQL_ROOT)
        with connection.cursor() as cursor:
            cursor.execute("SELECT name FROM app.legacy_migrations")
            done = {row[0] for row in cursor.fetchall()}
        pending = [(name, path) for name, path in files if name not in done]
        for name, path in pending:
            with transaction.atomic(), connection.cursor() as cursor:
                if not mark_applied:
                    cursor.execute(path.read_text())
                cursor.execute("INSERT INTO app.legacy_migrations(name) VALUES (%s)", [name])
            self.stdout.write(f"{'marked' if mark_applied else 'applied'} {name}")
        self.stdout.write(self.style.SUCCESS(f"{len(pending)} pending, {len(files)} total"))
