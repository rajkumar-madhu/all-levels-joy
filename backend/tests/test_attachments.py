import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.attachments.views import safe_file_name

from .conftest import seed

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def evidence_dir(settings, tmp_path):
    settings.STORAGES = {
        **settings.STORAGES,
        "evidence": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": str(tmp_path / "evidence")},
        },
    }
    return tmp_path / "evidence"


def raise_incident(client, org):
    created = client.post(
        f"/api/v1/orgs/{org}/incidents",
        {"title": "Screen flickers on dock", "description": "Started after update", "impact": 3, "urgency": 3},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def upload(client, url, name="screenshot.png", content=b"\x89PNG fake", content_type="image/png"):
    return client.post(url, {"file": SimpleUploadedFile(name, content, content_type=content_type)}, format="multipart")


def test_requester_attaches_evidence_and_staff_downloads_it(org, make_user, opa, evidence_dir):
    owner = make_user(org)
    agent = make_user(org, roles=("requester", "service_desk"))
    incident_id = raise_incident(owner, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}/attachments"

    created = upload(owner, url)
    assert created.status_code == 201, created.content
    [row] = created.json()["results"]
    assert (row["file_name"], row["size_bytes"], row["mime_type"]) == ("screenshot.png", 9, "image/png")
    stored = list(evidence_dir.rglob("*"))
    assert any(p.is_file() and p.read_bytes() == b"\x89PNG fake" for p in stored)
    path = seed("SELECT storage_path FROM public.attachments WHERE id = %s", [row["id"]])[0]
    assert path.startswith(f"{org}/incident/{incident_id}/") and path.count("/") == 3
    assert seed("SELECT count(*) FROM storage.objects WHERE name = %s", [path])[0] == 1
    assert (
        seed(
            "SELECT count(*) FROM public.audit_events WHERE record_id = %s AND action = 'attachment_added'",
            [incident_id],
        )[0]
        == 1
    )

    download = agent.get(f"/api/v1/orgs/{org}/attachments/{row['id']}/download")
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == b"\x89PNG fake"
    assert download["Content-Disposition"].startswith("attachment;")
    assert download["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in download["Content-Security-Policy"]
    assert [r["id"] for r in agent.get(url).json()["results"]] == [row["id"]]


def test_other_requesters_cannot_list_upload_or_download(org, make_user, opa):
    owner, stranger = make_user(org), make_user(org)
    incident_id = raise_incident(owner, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}/attachments"
    row = upload(owner, url).json()["results"][0]

    assert stranger.get(url).status_code == 404
    assert upload(stranger, url).status_code == 404
    assert stranger.get(f"/api/v1/orgs/{org}/attachments/{row['id']}/download").status_code == 404


def test_path_traversal_names_and_tampered_paths_are_refused(org, make_user, opa, evidence_dir):
    owner = make_user(org)
    agent = make_user(org, roles=("requester", "admin"))
    incident_id = raise_incident(owner, org)
    url = f"/api/v1/orgs/{org}/incidents/{incident_id}/attachments"

    row = upload(owner, url, name="../../etc/passwd", content=b"x", content_type="text/plain").json()["results"][0]
    assert row["file_name"] == "passwd"
    assert all(evidence_dir in p.parents for p in evidence_dir.rglob("*"))

    # A row whose path escapes its record (written directly, bypassing the API) is never served.
    seed(
        "UPDATE public.attachments SET storage_path = %s WHERE id = %s",
        [f"{org}/incident/{incident_id}/../../../../etc/passwd", row["id"]],
    )
    assert agent.get(f"/api/v1/orgs/{org}/attachments/{row['id']}/download").status_code == 404


def test_size_limit_and_unsupported_record_types(org, make_user, opa, settings):
    owner = make_user(org)
    incident_id = raise_incident(owner, org)
    settings.ATTACHMENT_MAX_BYTES = 4
    too_big = upload(owner, f"/api/v1/orgs/{org}/incidents/{incident_id}/attachments", content=b"12345")
    assert too_big.status_code == 400
    assert owner.get(f"/api/v1/orgs/{org}/problems/{incident_id}/attachments").status_code == 404


def test_file_names_are_reduced_to_a_safe_basename():
    assert safe_file_name("..\\..\\boot.ini") == "boot.ini"
    assert safe_file_name("../") == "file"
    assert safe_file_name("report <final>.pdf") == "report _final_.pdf"
    assert safe_file_name(".env") == "env"
