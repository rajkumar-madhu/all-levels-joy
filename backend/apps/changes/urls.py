from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/changes", views.ChangeListView.as_view()),
    path("orgs/<uuid:org_id>/changes/<uuid:change_id>", views.ChangeDetailView.as_view()),
    path("orgs/<uuid:org_id>/changes/<uuid:change_id>/actions", views.ChangeActionView.as_view()),
]
