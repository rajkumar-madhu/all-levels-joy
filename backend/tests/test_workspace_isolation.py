"""Schema hardening in apps/core/sql/0001_workspace_isolation.sql."""

import pytest
from django.core.management import call_command
from django.db import ProgrammingError, connection, transaction
from django.test import Client

from .conftest import create_org, seed
from .test_major_incidents import declare, raise_incident

pytestmark = pytest.mark.django_db(transaction=True)


def test_record_numbers_are_unique_per_workspace(make_user, opa):
    first, second = create_org(), create_org()
    # Both workspaces' counters stand at the same value, as they would for two fresh workspaces.
    for org in (first, second):
        seed("UPDATE public.record_counters SET current_value = 5000 WHERE organization_id = %s", [org])
    numbers = []
    for org in (first, second):
        agent = make_user(org, roles=("requester", "service_desk"))
        created = agent.post(
            f"/api/v1/orgs/{org}/incidents",
            {"title": "VPN drops every hour", "description": "Since Monday", "impact": 2, "urgency": 2},
            format="json",
        )
        assert created.status_code == 201, created.content
        numbers.append(created.json()["number"])
    assert numbers == ["INC0005001", "INC0005001"]
    # Still unique inside one workspace.
    with pytest.raises(Exception, match="organization_id_number_key"):
        seed(
            "INSERT INTO public.incidents(organization_id, number, title, description) "
            "VALUES (%s, 'INC0005001', 'dup', 'dup')",
            [first],
        )


def test_anonymous_knowledge_is_limited_to_the_portal_workspace(settings):
    portal, private = create_org(), create_org()
    settings.PORTAL_ORG_ID = portal
    call_command("sync_portal_workspace", verbosity=0)
    for org, title in ((portal, "Reset your password"), (private, "Internal firewall runbook")):
        seed(
            "INSERT INTO public.knowledge_articles(organization_id, number, title, category, status, published_at) "
            "VALUES (%s, 'KB000001', %s, 'Access', 'published', now())",
            [org, title],
        )
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL ROLE anon")
        cursor.execute(
            "SELECT title FROM public.knowledge_articles WHERE organization_id = ANY(%s::uuid[])", [[portal, private]]
        )
        assert [row[0] for row in cursor.fetchall()] == ["Reset your password"]
    listing = Client().get("/api/public/knowledge").json()
    assert [a["title"] for a in listing["articles"]] == ["Reset your password"]


def notified(major_id):
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT user_id::text, title FROM public.notifications WHERE record_id = %s ORDER BY user_id", [major_id]
        )
        return cursor.fetchall()


def test_declaring_a_major_incident_notifies_active_responders_once(org, make_user, opa):
    declarer = make_user(org, roles=("requester", "service_desk"))
    manager = make_user(org, roles=("requester", "manager", "admin"))
    change_manager = make_user(org, roles=("requester", "change_manager"))
    engineer = make_user(org, roles=("requester", "fulfiller"))
    requester = make_user(org)
    former = make_user(org, roles=("requester", "manager"))
    seed("UPDATE public.memberships SET is_active = false WHERE user_id = %s", [former.user_id])
    outsider = make_user(create_org(), roles=("requester", "manager"))

    declared = declare(declarer, org, raise_incident(declarer, org))
    assert declared.status_code == 201, declared.content
    major = declared.json()

    rows = notified(major["id"])
    assert sorted(user for user, _ in rows) == sorted([manager.user_id, change_manager.user_id])
    assert {title for _, title in rows} == {f"{major['number']} declared — severity 1"}
    for person in (declarer, engineer, requester, former, outsider):
        assert person.user_id not in [user for user, _ in rows]

    # The bell shows it to the recipient.
    bell = manager.get(f"/api/v1/orgs/{org}/notifications").json()
    titles = [n["title"] for n in (bell["results"] if isinstance(bell, dict) else bell)]
    assert f"{major['number']} declared — severity 1" in titles


def test_only_the_declarer_can_send_declaration_notifications(org, make_user, opa):
    declarer = make_user(org, roles=("requester", "service_desk"))
    other = make_user(org, roles=("requester", "manager"))
    major_id = declare(declarer, org, raise_incident(declarer, org)).json()["id"]
    with pytest.raises(ProgrammingError, match="Only the person who declared"), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", [other.user_id])
            cursor.execute("SET LOCAL ROLE authenticated")
            cursor.execute("SELECT public.itsm_notify_major_incident_declared(%s)", [major_id])
    # Calling again as the declarer sends nothing new.
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", [declarer.user_id])
        cursor.execute("SET LOCAL ROLE authenticated")
        cursor.execute("SELECT public.itsm_notify_major_incident_declared(%s)", [major_id])
        assert cursor.fetchone()[0] == 0
    assert len(notified(major_id)) == 1
