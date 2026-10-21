from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/catalog", views.CatalogView.as_view()),
    path("orgs/<uuid:org_id>/requests", views.RequestListView.as_view()),
    path("orgs/<uuid:org_id>/requests/<uuid:request_id>", views.RequestDetailView.as_view()),
]
