import uuid

import pytest
from rest_framework.test import APIClient

from .conftest import make_token, seed

pytestmark = pytest.mark.django_db(transaction=True)


def admin_url(org, path=""):
    return f"/api/v1/orgs/{org}/administration{path}"


def client_for(subject: str, email: str, verified: bool = True) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(subject, email, verified=verified)}")
    return client


def test_only_admins_can_administer(org, make_user, opa):
    manager = make_user(org, roles=("requester", "manager"))
    assert manager.get(admin_url(org)).status_code == 403
    assert (
        manager.post(
            admin_url(org, "/invitations"), {"email": "x@wecrew.in", "roles": ["requester"]}, format="json"
        ).status_code
        == 403
    )


def test_invitation_round_trip_with_matching_verified_email(org, make_user, opa):
    admin = make_user(org, roles=("requester", "admin"))
    email = f"new-{uuid.uuid4().hex[:8]}@wecrew.in"
    created = admin.post(
        admin_url(org, "/invitations"), {"email": email.upper(), "roles": ["service_desk"]}, format="json"
    )
    assert created.status_code == 201, created.content
    invitation_id = created.json()["id"]
    overview = admin.get(admin_url(org)).json()
    [pending] = [i for i in overview["invitations"] if i["id"] == invitation_id]
    assert pending["email"] == email and pending["status"] == "pending"
    # Requester is the baseline role and is always added.
    assert sorted(pending["roles"]) == ["requester", "service_desk"]

    invitee = client_for(f"kc-{uuid.uuid4()}", email)
    details = invitee.get(f"/api/v1/invitations/{invitation_id}")
    assert details.status_code == 200, details.content
    assert details.json()["organization_id"] == org
    assert invitee.get("/api/v1/me").json()["workspaces"] == []
    accepted = invitee.post(f"/api/v1/invitations/{invitation_id}")
    assert accepted.status_code == 200, accepted.content
    workspaces = invitee.get("/api/v1/me").json()["workspaces"]
    assert [(w["id"], sorted(w["roles"])) for w in workspaces] == [(org, ["requester", "service_desk"])]
    again = invitee.post(f"/api/v1/invitations/{invitation_id}")
    assert again.status_code == 400


def test_invitation_refuses_other_or_unverified_or_changed_emails(org, make_user, opa):
    admin = make_user(org, roles=("requester", "admin"))
    email = f"inv-{uuid.uuid4().hex[:8]}@wecrew.in"
    invitation_id = admin.post(
        admin_url(org, "/invitations"), {"email": email, "roles": ["requester"]}, format="json"
    ).json()["id"]
    stranger = client_for(f"kc-{uuid.uuid4()}", f"other-{uuid.uuid4().hex[:6]}@wecrew.in")
    assert stranger.get(f"/api/v1/invitations/{invitation_id}").status_code == 403
    assert stranger.post(f"/api/v1/invitations/{invitation_id}").status_code == 403
    assert (
        client_for(f"kc-{uuid.uuid4()}", email, verified=False).get(f"/api/v1/invitations/{invitation_id}").status_code
        == 401
    )

    # Linked to the invited address at first sign-in, but the token now carries a different email.
    subject = f"kc-{uuid.uuid4()}"
    assert client_for(subject, email).get("/api/v1/me").status_code == 200
    changed = client_for(subject, f"changed-{uuid.uuid4().hex[:6]}@wecrew.in")
    response = changed.post(f"/api/v1/invitations/{invitation_id}")
    assert response.status_code == 403 and "verified email" in response.json()["detail"]
    assert seed("SELECT status FROM public.workspace_invitations WHERE id = %s", [invitation_id])[0] == "pending"


def test_revoke_and_member_updates_use_versions(org, make_user, opa):
    admin = make_user(org, roles=("requester", "admin"))
    agent = make_user(org, roles=("requester", "service_desk"))
    invitation_id = admin.post(
        admin_url(org, "/invitations"), {"email": "rev@wecrew.in", "roles": ["requester"]}, format="json"
    ).json()["id"]
    overview = admin.get(admin_url(org)).json()
    version = next(i["version"] for i in overview["invitations"] if i["id"] == invitation_id)
    assert (
        admin.post(
            admin_url(org, f"/invitations/{invitation_id}/revoke"), {"expectedVersion": version + 5}, format="json"
        ).status_code
        == 400
    )
    assert (
        admin.post(
            admin_url(org, f"/invitations/{invitation_id}/revoke"), {"expectedVersion": version}, format="json"
        ).status_code
        == 200
    )

    member = next(m for m in overview["members"] if m["user_id"] == agent.user_id)
    body = {"roles": ["requester", "fulfiller"], "isActive": True, "expectedVersion": member["version"]}
    assert admin.patch(admin_url(org, f"/members/{agent.user_id}"), body, format="json").status_code == 200
    assert admin.patch(admin_url(org, f"/members/{agent.user_id}"), body, format="json").status_code == 400
    roles = seed(
        "SELECT array_agg(role::text ORDER BY role::text) FROM public.user_roles "
        "WHERE organization_id = %s AND user_id = %s",
        [org, agent.user_id],
    )[0]
    assert roles == ["fulfiller", "requester"]
    assert (
        admin.patch(
            admin_url(org, f"/members/{agent.user_id}"), {**body, "roles": ["requester", "requester"]}, format="json"
        ).status_code
        == 400
    )


def test_last_admin_cannot_remove_their_own_access(org, make_user, opa):
    admin = make_user(org, roles=("requester", "admin"))
    member = next(m for m in admin.get(admin_url(org)).json()["members"] if m["user_id"] == admin.user_id)
    response = admin.patch(
        admin_url(org, f"/members/{admin.user_id}"),
        {"roles": ["requester"], "isActive": True, "expectedVersion": member["version"]},
        format="json",
    )
    assert response.status_code == 400


def test_groups_and_workspace_settings(org, make_user, opa):
    admin = make_user(org, roles=("requester", "admin"))
    agent = make_user(org, roles=("requester", "service_desk"))
    created = admin.post(
        admin_url(org, "/groups"),
        {"name": "Network ops", "description": "WAN and VPN", "memberIds": [agent.user_id]},
        format="json",
    )
    assert created.status_code == 201, created.content
    group_id = created.json()["id"]
    group = next(g for g in admin.get(admin_url(org)).json()["groups"] if g["id"] == group_id)
    assert group["member_ids"] == [agent.user_id]
    assert admin.put(admin_url(org, f"/groups/{group_id}"), {"name": "Network ops"}, format="json").status_code == 400
    archived = admin.put(
        admin_url(org, f"/groups/{group_id}"),
        {"name": "Network operations", "isActive": False, "memberIds": [], "expectedVersion": group["version"]},
        format="json",
    )
    assert archived.status_code == 200, archived.content

    organization = admin.get(admin_url(org)).json()["organization"]
    saved = admin.patch(
        admin_url(org, "/workspace"),
        {"name": "WeCrew Pune", "timezone": "Asia/Kolkata", "expectedVersion": organization["admin_version"]},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert seed("SELECT name, timezone FROM public.organizations WHERE id = %s", [org]) == (
        "WeCrew Pune",
        "Asia/Kolkata",
    )
    stale = admin.patch(
        admin_url(org, "/workspace"),
        {"name": "Again", "timezone": "UTC", "expectedVersion": organization["admin_version"]},
        format="json",
    )
    assert stale.status_code == 400


def test_audit_trail_for_staff_with_filters_and_pages(org, make_user, opa):
    requester = make_user(org)
    agent = make_user(org, roles=("requester", "service_desk"))
    admin = make_user(org, roles=("requester", "admin"))
    for n in range(55):
        seed(
            "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source) "
            "VALUES (%s, 'knowledge', gen_random_uuid(), %s, %s, 'application')",
            [org, agent.user_id, f"viewed_{n}"],
        )
    admin.post(admin_url(org, "/invitations"), {"email": "audit@wecrew.in", "roles": ["requester"]}, format="json")

    assert requester.get(f"/api/v1/orgs/{org}/audit").status_code == 403
    first = agent.get(f"/api/v1/orgs/{org}/audit?recordType=knowledge").json()
    assert len(first["results"]) == 50 and first["next"]
    second = agent.get(f"/api/v1/orgs/{org}/audit", {"recordType": "knowledge", "before": first["next"]}).json()
    assert len(second["results"]) == 5 and second["next"] is None
    assert not {r["id"] for r in first["results"]} & {r["id"] for r in second["results"]}
    # Administration evidence is visible to administrators only.
    assert "workspace_invitation" not in agent.get(f"/api/v1/orgs/{org}/audit/facets").json()["recordTypes"]
    assert "workspace_invitation" in admin.get(f"/api/v1/orgs/{org}/audit/facets").json()["recordTypes"]


def test_profile_updates_own_row_and_audits(org, make_user, opa):
    person = make_user(org)
    response = person.patch(
        "/api/v1/me/profile",
        {
            "displayName": "Priya Nair",
            "phone": "+91 98000 00000",
            "jobTitle": "Analyst",
            "department": "Finance",
            "locale": "en-IN",
            "timezone": "Asia/Kolkata",
            "emailDigest": False,
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    body = person.get("/api/v1/me/profile").json()
    assert (body["display_name"], body["timezone"], body["preferences"]) == (
        "Priya Nair",
        "Asia/Kolkata",
        {"emailDigest": False},
    )
    assert person.patch("/api/v1/me/profile", {"displayName": "P"}, format="json").status_code == 400
    assert (
        seed(
            "SELECT count(*) FROM public.audit_events WHERE record_type = 'profile' AND record_id = %s",
            [person.user_id],
        )[0]
        == 1
    )


def test_notifications_are_private_and_marked_read_explicitly(org, make_user, opa):
    alice, bob = make_user(org), make_user(org)
    for user, title in ((alice, "REQ approved"), (alice, "Change scheduled"), (bob, "Bob only")):
        seed(
            "INSERT INTO public.notifications(organization_id, user_id, title, body) VALUES (%s, %s, %s, 'x')",
            [org, user.user_id, title],
        )
    listed = alice.get(f"/api/v1/orgs/{org}/notifications").json()
    assert sorted(n["title"] for n in listed["results"]) == ["Change scheduled", "REQ approved"]
    assert listed["unreadRecent"] == 2
    # Listing does not mark anything read.
    assert alice.get(f"/api/v1/orgs/{org}/notifications").json()["unreadRecent"] == 2
    assert alice.post(f"/api/v1/orgs/{org}/notifications/read-all").json() == {"ok": True, "marked": 2}
    assert alice.get(f"/api/v1/orgs/{org}/notifications").json()["unreadRecent"] == 0
    assert bob.get(f"/api/v1/orgs/{org}/notifications").json()["unreadRecent"] == 1
