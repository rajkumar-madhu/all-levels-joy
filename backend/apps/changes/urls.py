from django.urls import path

from . import link_views, views

urlpatterns = [
    path("orgs/<uuid:org_id>/change-link-candidates", link_views.LinkCandidatesView.as_view()),
    path("orgs/<uuid:org_id>/changes/<uuid:change_id>/links", link_views.ChangeLinksView.as_view()),
    path("orgs/<uuid:org_id>/changes/<uuid:change_id>/links/<uuid:link_id>", link_views.ChangeLinkDetailView.as_view()),
    path("orgs/<uuid:org_id>/incidents/<uuid:incident_id>/links", link_views.IncidentLinksView.as_view()),
    path("orgs/<uuid:org_id>/changes", views.ChangeListView.as_view()),
    path("orgs/<uuid:org_id>/changes/<uuid:change_id>", views.ChangeDetailView.as_view()),
    path("orgs/<uuid:org_id>/changes/<uuid:change_id>/actions", views.ChangeActionView.as_view()),
]
