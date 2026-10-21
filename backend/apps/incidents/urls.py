from django.urls import path

from . import operator_views, views

urlpatterns = [
    path("orgs/<uuid:org_id>/incidents/operator", operator_views.OperatorIncidentView.as_view()),
    path("orgs/<uuid:org_id>/incidents/queue-counts", operator_views.QueueCountsView.as_view()),
    path("orgs/<uuid:org_id>/incidents", views.IncidentListView.as_view()),
    path("orgs/<uuid:org_id>/incidents/<uuid:incident_id>", views.IncidentDetailView.as_view()),
]
