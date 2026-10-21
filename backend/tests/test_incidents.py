import pytest

pytestmark = pytest.mark.django_db(transaction=True)


def test_requester_raises_and_sees_only_own_incidents(org, make_user, opa):
    alice, bob = make_user(org), make_user(org)
    created = alice.post(
        f"/api/v1/orgs/{org}/incidents",
        {
            "title": "VPN drops every hour",
            "description": "Disconnects at :00 since Monday",
            "impact": 2,
            "urgency": 2,
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["number"].startswith("INC")

    mine = alice.get(f"/api/v1/orgs/{org}/incidents").json()["results"]
    assert [i["id"] for i in mine] == [created.json()["id"]]
    assert bob.get(f"/api/v1/orgs/{org}/incidents").json()["results"] == []
    assert bob.get(f"/api/v1/orgs/{org}/incidents/{created.json()['id']}").status_code == 404


def test_database_rule_errors_are_returned_as_400(org, make_user, opa):
    client = make_user(org)
    response = client.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": "     ok   ", "description": "Long enough description", "impact": 1, "urgency": 1},
        format="json",
    )
    assert response.status_code == 400
