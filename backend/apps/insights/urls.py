from django.urls import path, register_converter

from . import views


class TicketTypeConverter:
    regex = "|".join(views.TICKETS)

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value


register_converter(TicketTypeConverter, "ticket_type")

urlpatterns = [
    path("orgs/<uuid:org_id>/sla", views.SlaView.as_view()),
    path("orgs/<uuid:org_id>/insights/incidents", views.IncidentMetricsView.as_view()),
    # /orgs/{org}/incidents/{id}/activity and /orgs/{org}/requests/{id}/activity
    path("orgs/<uuid:org_id>/<ticket_type:record_type>s/<uuid:record_id>/activity", views.ActivityView.as_view()),
    path("orgs/<uuid:org_id>/search", views.SearchView.as_view()),
]
