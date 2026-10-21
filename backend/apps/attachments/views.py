"""Evidence attachments on incidents, requests and changes (legacy itsm-evidence bucket).

Files never get a public URL. Uploads and downloads go through these views, which first prove access in the
database as the caller: the attachments row and a storage.objects row are written under RLS
(can_access_record / can_access_evidence_path), and downloads re-check can_access_evidence_path.
"""

import re
import uuid

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import storages
from django.http import FileResponse, Http404
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.core.db import call_function, execute, fetch_all, fetch_one
from apps.core.views import CallerAPIView

BUCKET = "itsm-evidence"
RECORD_TABLES = {"incident": "incidents", "request": "service_requests", "change": "changes"}
SAFE_INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "application/pdf", "text/plain"}


def evidence_storage():
    return storages["evidence"]


def safe_file_name(name: str) -> str:
    """Basename only, legacy character set, no leading dots, at most 120 characters."""
    base = re.split(r"[\\/]", name or "")[-1]
    cleaned = re.sub(r"[^\w.\-() ]+", "_", base).strip().lstrip(".")
    return cleaned[-120:] or "file"


def evidence_path(org_id: str, record_type: str, record_id: str, file_name: str) -> str:
    # Exactly four segments, which is what can_access_evidence_path accepts.
    return f"{org_id}/{record_type}/{record_id}/{uuid.uuid4().hex}-{file_name}"


def path_matches_row(row: dict) -> bool:
    parts = row["storage_path"].split("/")
    return (
        len(parts) == 4
        and parts[:3] == [str(row["organization_id"]), row["record_type"], str(row["record_id"])]
        and parts[3] not in ("", ".", "..")
        and "\\" not in row["storage_path"]
    )


class UploadSerializer(serializers.Serializer):
    file = serializers.FileField(allow_empty_file=False)


class AttachmentsView(CallerAPIView):
    policy_actions = {"GET": "attachment.read", "POST": "attachment.create"}
    parser_classes = [MultiPartParser, FormParser]

    def record_visible(self, record_type: str, record_id) -> bool:
        return bool(
            fetch_one(
                f"SELECT 1 AS ok FROM public.{RECORD_TABLES[record_type]} WHERE organization_id = %s AND id = %s",
                [self.org_id, str(record_id)],
            )
        )

    def rows(self, record_type: str, record_id) -> list[dict]:
        return fetch_all(
            "SELECT a.id, a.file_name, a.mime_type, a.size_bytes, a.created_at, a.uploader_id, "
            "p.display_name AS uploader_name FROM public.attachments a "
            "LEFT JOIN public.profiles p ON p.id = a.uploader_id "
            "WHERE a.organization_id = %s AND a.record_type = %s AND a.record_id = %s ORDER BY a.created_at DESC",
            [self.org_id, record_type, str(record_id)],
        )

    def get(self, request, org_id, record_type, record_id):
        if not self.record_visible(record_type, record_id):
            raise Http404
        return Response({"results": self.rows(record_type, record_id)})

    def post(self, request, org_id, record_type, record_id):
        if not self.record_visible(record_type, record_id):
            raise Http404
        data = UploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        upload = data.validated_data["file"]
        if upload.size > settings.ATTACHMENT_MAX_BYTES:
            limit_mb = settings.ATTACHMENT_MAX_BYTES // (1024 * 1024)
            return Response({"detail": f"Files can be at most {limit_mb} MB."}, status=400)
        file_name = safe_file_name(upload.name)
        path = evidence_path(self.org_id, record_type, str(record_id), file_name)
        mime = (upload.content_type or "")[:120] or None
        actor = request.user.user_id
        # Both inserts are checked by RLS as the caller; a refusal aborts before anything is stored.
        execute("INSERT INTO storage.objects(bucket_id, name, owner) VALUES (%s, %s, %s)", [BUCKET, path, actor])
        execute(
            "INSERT INTO public.attachments(organization_id, record_type, record_id, uploader_id, storage_path, "
            "file_name, mime_type, size_bytes) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            [self.org_id, record_type, str(record_id), actor, path, file_name, mime, upload.size],
        )
        execute(
            "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source, "
            "after_values) VALUES (%s, %s, %s, %s, 'attachment_added', 'application', "
            "jsonb_build_object('file_name', %s::text))",
            [self.org_id, record_type, str(record_id), actor, file_name],
        )
        saved = evidence_storage().save(path, upload)
        if saved != path:
            raise RuntimeError("Evidence storage changed the object name")
        return Response({"results": self.rows(record_type, record_id)}, status=status.HTTP_201_CREATED)


class DownloadView(CallerAPIView):
    policy_actions = {"GET": "attachment.read"}

    def get(self, request, org_id, attachment_id):
        row = fetch_one(
            "SELECT organization_id, record_type, record_id, storage_path, file_name, mime_type "
            "FROM public.attachments WHERE organization_id = %s AND id = %s",
            [self.org_id, str(attachment_id)],
        )
        if not row or not path_matches_row(row):
            raise Http404
        if not call_function("can_access_evidence_path", [("_path", row["storage_path"], "text")]):
            raise Http404
        try:
            handle = evidence_storage().open(row["storage_path"], "rb")
        except (FileNotFoundError, SuspiciousFileOperation) as error:
            raise Http404 from error
        mime = row["mime_type"] if row["mime_type"] in SAFE_INLINE_TYPES else "application/octet-stream"
        response = FileResponse(handle, as_attachment=True, filename=row["file_name"], content_type=mime)
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        response["Cache-Control"] = "private, no-store"
        return response
