from django.urls import path, register_converter

from . import views


class AttachmentRecordTypeConverter:
    regex = "|".join(views.RECORD_TABLES)

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value


register_converter(AttachmentRecordTypeConverter, "attachment_record_type")

urlpatterns = [
    # /orgs/{org}/incidents/{id}/attachments, /requests/{id}/attachments, /changes/{id}/attachments
    path(
        "orgs/<uuid:org_id>/<attachment_record_type:record_type>s/<uuid:record_id>/attachments",
        views.AttachmentsView.as_view(),
    ),
    path("orgs/<uuid:org_id>/attachments/<uuid:attachment_id>/download", views.DownloadView.as_view()),
]
