import pytest

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)

ARTICLE = {
    "title": "Reset your VPN token",
    "summary": "Steps for an expired token",
    "content": "Open the portal, choose Reset token, and follow the prompts.",
    "category": "Network",
    "tags": ["VPN", " vpn ", "Remote Access!", ""],
}


def test_draft_review_publish_and_retire(org, make_user, opa):
    author = make_user(org, roles=("requester", "fulfiller"))
    reader = make_user(org)
    base = f"/api/v1/orgs/{org}/knowledge"

    created = author.post(base, {**ARTICLE, "status": "draft"}, format="json")
    assert created.status_code == 201, created.content
    article = created.json()
    assert article["number"].startswith("KB") and article["tags"] == ["vpn", "remote-access"]
    assert article["published_at"] is None
    url = f"{base}/{article['id']}"

    # Requesters only ever see published articles (RLS).
    assert reader.get(url).status_code == 404
    assert article["id"] not in [a["id"] for a in reader.get(base).json()["results"]]

    review = author.patch(
        url, {**ARTICLE, "status": "review", "expectedUpdatedAt": article["updated_at"]}, format="json"
    )
    assert review.status_code == 200 and review.json()["status"] == "review"
    stale = author.patch(
        url, {**ARTICLE, "status": "published", "expectedUpdatedAt": article["updated_at"]}, format="json"
    )
    assert stale.status_code == 409
    published = author.patch(
        url, {**ARTICLE, "status": "published", "expectedUpdatedAt": review.json()["updated_at"]}, format="json"
    ).json()
    assert published["published_at"] and published["version"] == 1
    assert reader.get(url).status_code == 200

    edited = author.patch(
        url,
        {
            **ARTICLE,
            "title": "Reset an expired VPN token",
            "status": "published",
            "expectedUpdatedAt": published["updated_at"],
        },
        format="json",
    ).json()
    assert edited["version"] == 2

    retired = author.patch(
        url, {**ARTICLE, "status": "retired", "expectedUpdatedAt": edited["updated_at"]}, format="json"
    )
    assert retired.json()["published_at"] is None
    assert reader.get(url).status_code == 404
    assert author.get(f"{base}?status=retired").json()["results"][0]["id"] == article["id"]
    actions = seed(
        "SELECT array_agg(action ORDER BY created_at) FROM public.audit_events WHERE record_id = %s", [article["id"]]
    )[0]
    assert actions == ["created", "updated", "updated", "updated", "updated"]


def test_edits_require_the_version_being_edited(org, make_user, opa):
    author = make_user(org, roles=("requester", "service_desk"))
    article = author.post(f"/api/v1/orgs/{org}/knowledge", {**ARTICLE, "status": "draft"}, format="json").json()
    response = author.patch(
        f"/api/v1/orgs/{org}/knowledge/{article['id']}", {**ARTICLE, "status": "review"}, format="json"
    )
    assert response.status_code == 400


def test_only_authors_write_articles(org, make_user, opa):
    for roles in (("requester",), ("requester", "change_manager")):
        client = make_user(org, roles=roles)
        assert (
            client.post(f"/api/v1/orgs/{org}/knowledge", {**ARTICLE, "status": "draft"}, format="json").status_code
            == 403
        )


def test_categories_create_rename_and_carry_articles(org, make_user, opa):
    author = make_user(org, roles=("requester", "manager"))
    reader = make_user(org)
    base = f"/api/v1/orgs/{org}/knowledge/categories"
    created = author.post(base, {"name": "Network", "description": "VPN, Wi-Fi and DNS"}, format="json")
    assert created.status_code == 201, created.content
    assert author.post(base, {"name": "network"}, format="json").status_code == 400
    assert reader.post(base, {"name": "Printers"}, format="json").status_code == 403

    author.post(f"/api/v1/orgs/{org}/knowledge", {**ARTICLE, "status": "published"}, format="json")
    renamed = author.patch(f"{base}/{created.json()['id']}", {"name": "Networking", "active": True}, format="json")
    assert renamed.status_code == 200
    categories = reader.get(base).json()["results"]
    assert [(c["name"], c["slug"], c["article_count"]) for c in categories] == [("Networking", "networking", 1)]
    assert reader.get(f"/api/v1/orgs/{org}/knowledge?category=Networking").json()["results"]
