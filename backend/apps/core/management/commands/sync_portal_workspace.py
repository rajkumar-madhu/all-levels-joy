"""Publish knowledge anonymously from PORTAL_ORG_ID only.

Anonymous visitors (the customer portal) may read published articles of workspaces flagged
`knowledge_public`. Run after `apply_app_schema` so the flag follows the configured portal workspace.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction


class Command(BaseCommand):
    help = "Flag PORTAL_ORG_ID as the only workspace whose published knowledge anonymous visitors can read."

    def handle(self, *args, **options):
        org = settings.PORTAL_ORG_ID
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM public.organizations WHERE id = %s", [org])
            if not cursor.fetchone():
                raise CommandError(f"PORTAL_ORG_ID {org} is not a workspace")
            cursor.execute(
                "UPDATE public.organizations SET knowledge_public = (id = %s) "
                "WHERE knowledge_public IS DISTINCT FROM (id = %s)",
                [org, org],
            )
            changed = cursor.rowcount
        self.stdout.write(self.style.SUCCESS(f"public knowledge workspace: {org} ({changed} changed)"))
