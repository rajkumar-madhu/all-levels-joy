import pytest
from rest_framework.test import APIClient

from .conftest import create_org, make_token

pytestmark = pytest.mark.django_db(transaction=True)


def test_auth_uid_reads_request_claim():
    from django.db import connection, transaction

    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000abcd', true)")
        cursor.execute("SELECT auth.uid()")
        assert str(cursor.fetchone()[0]) == "00000000-0000-0000-0000-00000000abcd"


def test_first_sign_in_links_existing_account_by_verified_email(org, make_user, opa):
    existing = make_user(org, roles=("requester", "service_desk"), email="linked@wecrew.in")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token('kc-new-subject', 'Linked@wecrew.in')}")
    body = client.get("/api/v1/me").json()
    assert body["user_id"] == existing.user_id
    assert body["workspaces"] == [
        {
            "id": org,
            "name": body["workspaces"][0]["name"],
            "slug": body["workspaces"][0]["slug"],
            "roles": ["requester", "service_desk"],
            "is_staff": True,
        }
    ]
    # Second sign-in uses the stored link.
    assert client.get("/api/v1/me").json()["user_id"] == existing.user_id


def test_unverified_email_is_rejected():
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token('kc-unverified', 'x@wecrew.in', verified=False)}")
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    assert "Verify your email" in response.json()["detail"]


def test_token_for_another_audience_is_rejected():
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token('kc-aud', 'a@wecrew.in', audience='other')}")
    assert client.get("/api/v1/me").status_code == 401


def test_missing_token_is_rejected(org):
    assert APIClient().get(f"/api/v1/orgs/{org}/incidents").status_code in (401, 403)


def test_opa_outage_fails_closed(org, make_user, settings):
    settings.OPA_URL = "http://127.0.0.1:9"
    response = make_user(org).get(f"/api/v1/orgs/{org}/incidents")
    assert response.status_code == 503


def test_roles_from_another_workspace_do_not_apply(org, make_user, opa):
    other = create_org("Other")
    admin_elsewhere = make_user(str(other), roles=("requester", "admin"))
    assert admin_elsewhere.get(f"/api/v1/orgs/{org}/security/board").status_code == 403
