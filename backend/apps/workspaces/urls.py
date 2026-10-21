from django.urls import path

from . import views

urlpatterns = [
    path("me", views.MeView.as_view()),
    path("me/bootstrap", views.BootstrapView.as_view()),
    path("orgs/<uuid:org_id>/groups", views.GroupsView.as_view()),
]
