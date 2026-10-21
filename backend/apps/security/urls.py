from django.urls import path

from . import views

prefix = "orgs/<uuid:org_id>/security"
urlpatterns = [
    path(f"{prefix}/board", views.BoardView.as_view()),
    path(f"{prefix}/findings", views.FindingCreateView.as_view()),
    path(f"{prefix}/findings/<uuid:finding_id>/transition", views.FindingTransitionView.as_view()),
    path(f"{prefix}/findings/<uuid:finding_id>/exceptions", views.ExceptionRequestView.as_view()),
    path(f"{prefix}/exceptions/<uuid:exception_id>/decision", views.ExceptionDecisionView.as_view()),
]
