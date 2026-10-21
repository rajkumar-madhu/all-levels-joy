"""Give an email address an active membership and roles in a workspace.

Use it to admit the first administrator after cutover; everyone else is invited from the
Administration screen. The account links to Keycloak on first sign-in with the same verified email.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

ROLES = {"requester", "service_desk", "fulfiller", "change_manager", "cab_member", "cmdb_manager", "manager", "admin"}


class Command(BaseCommand):
    help = "Create or update a workspace membership and roles for an email address."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--org", default="10000000-0000-0000-0000-000000000001")
        parser.add_argument("--roles", default="requester", help="Comma-separated app_role values")

    def handle(self, *args, email: str, org: str, roles: str, **options):
        wanted = {r.strip() for r in roles.split(",") if r.strip()} | {"requester"}
        unknown = wanted - ROLES
        if unknown:
            raise CommandError(f"Unknown roles: {', '.join(sorted(unknown))}")
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM public.organizations WHERE id = %s", [org])
            if not cursor.fetchone():
                raise CommandError(f"Workspace {org} does not exist")
            cursor.execute(
                "SELECT id FROM auth.users WHERE lower(email) = lower(%s) ORDER BY created_at LIMIT 1", [email]
            )
            row = cursor.fetchone()
            if row:
                user_id = row[0]
            else:
                cursor.execute(
                    "INSERT INTO auth.users(email, email_confirmed_at) VALUES (%s, now()) RETURNING id", [email]
                )
                user_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO public.profiles(id, display_name) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
                [user_id, email.split("@")[0]],
            )
            cursor.execute(
                "INSERT INTO public.memberships(organization_id, user_id, is_active) VALUES (%s, %s, true) "
                "ON CONFLICT (organization_id, user_id) DO UPDATE SET is_active = true",
                [org, user_id],
            )
            for role in sorted(wanted):
                cursor.execute(
                    "INSERT INTO public.user_roles(organization_id, user_id, role) VALUES (%s, %s, %s) "
                    "ON CONFLICT (organization_id, user_id, role) DO NOTHING",
                    [org, user_id, role],
                )
        self.stdout.write(self.style.SUCCESS(f"{email} ({user_id}) -> {', '.join(sorted(wanted))}"))
