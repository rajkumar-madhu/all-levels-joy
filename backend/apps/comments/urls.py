from django.urls import path, register_converter

from . import views


class RecordTypeConverter:
    regex = "|".join(views.RECORD_TABLES)

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value


register_converter(RecordTypeConverter, "record_type")

# /orgs/{org}/incidents/{id}/comments and /orgs/{org}/requests/{id}/comments
urlpatterns = [
    path(
        "orgs/<uuid:org_id>/<record_type:record_type>s/<uuid:record_id>/comments",
        views.CommentsView.as_view(),
    ),
]
