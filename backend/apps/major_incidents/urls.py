from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/command-center", views.CommandCenterView.as_view()),
    path("orgs/<uuid:org_id>/major-incidents", views.DeclareView.as_view()),
    path("orgs/<uuid:org_id>/major-incidents/<uuid:major_id>", views.MajorIncidentView.as_view()),
    path("orgs/<uuid:org_id>/major-incidents/<uuid:major_id>/updates", views.PostUpdateView.as_view()),
]
