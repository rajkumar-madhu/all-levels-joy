from django.urls import path

from . import admin_views, views

urlpatterns = [
    path("orgs/<uuid:org_id>/catalog", views.CatalogView.as_view()),
    path("orgs/<uuid:org_id>/catalog/admin", admin_views.CatalogAdminListView.as_view()),
    path("orgs/<uuid:org_id>/catalog/<uuid:item_id>", admin_views.CatalogItemAdminView.as_view()),
    path("orgs/<uuid:org_id>/requests/<uuid:request_id>/tasks", admin_views.RequestTasksView.as_view()),
    path(
        "orgs/<uuid:org_id>/requests/<uuid:request_id>/tasks/<uuid:task_id>",
        admin_views.RequestTaskDetailView.as_view(),
    ),
    path("orgs/<uuid:org_id>/requests", views.RequestListView.as_view()),
    path("orgs/<uuid:org_id>/requests/<uuid:request_id>", views.RequestDetailView.as_view()),
]
