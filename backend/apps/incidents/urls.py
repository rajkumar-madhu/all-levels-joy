from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/incidents", views.IncidentListView.as_view()),
    path("orgs/<uuid:org_id>/incidents/<uuid:incident_id>", views.IncidentDetailView.as_view()),
]
