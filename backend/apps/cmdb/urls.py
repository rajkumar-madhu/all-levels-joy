from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/services", views.ServicesView.as_view()),
    path("orgs/<uuid:org_id>/assets", views.AssetListView.as_view()),
    path("orgs/<uuid:org_id>/assets/<uuid:asset_id>", views.AssetDetailView.as_view()),
    path("orgs/<uuid:org_id>/assets/<uuid:asset_id>/relationships", views.RelationshipsView.as_view()),
    path(
        "orgs/<uuid:org_id>/assets/<uuid:asset_id>/relationships/<uuid:relationship_id>",
        views.RelationshipDetailView.as_view(),
    ),
]
